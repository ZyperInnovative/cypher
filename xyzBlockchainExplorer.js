// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDIwoUIMJrJQeLBD9vijsfIUXG9BgaGSPs",
    authDomain: "miner-zyx.firebaseapp.com",
    projectId: "miner-zyx",
    storageBucket: "miner-zyx.appspot.com",
    messagingSenderId: "430019680448",
    appId: "1:430019680448:web:d066b8aaf4355907e1b525",
    measurementId: "G-V6SDWYH6M2"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Blockchain Configuration
const BLOCK_CAPACITY = 10;
let currentBlockSize = 0;
let currentBlockNumber = 0;
let currentBlockTransactions = [];
let blockchainInitialized = false;

// Generate SHA-256 Hash
function generateHash(data) {
    const stringData = JSON.stringify(data);
    return sha256(stringData);
}

// Generate transaction hash
function generateTransactionHash(txData) {
    const txString = `${txData.from}${txData.to}${txData.amount}${txData.timestamp}${txData.nonce}`;
    return sha256(txString);
}

// Generate block hash
function generateBlockHash(blockData) {
    const blockString = `${blockData.previousHash}${JSON.stringify(blockData.transactions)}${blockData.timestamp}${blockData.nonce}`;
    return sha256(blockString);
}

// Create new block
async function createNewBlock(transactions, previousHash = '0'.repeat(64)) {
    currentBlockNumber++;
    
    const blockData = {
        blockNumber: currentBlockNumber,
        previousHash: previousHash,
        transactions: transactions,
        timestamp: new Date().toISOString(),
        nonce: Math.floor(Math.random() * 1000000),
        miner: 'XYZ Blockchain Network',
        difficulty: '0x3ffffff',
        size: `${transactions.length} transactions`
    };
    
    // Generate block hash
    blockData.hash = generateBlockHash(blockData);
    
    // Store block in Firebase
    await db.collection('blocks').doc(`block-${currentBlockNumber}`).set(blockData);
    
    // Store transactions with block reference
    for (const tx of transactions) {
        tx.blockNumber = currentBlockNumber;
        tx.blockHash = blockData.hash;
        await db.collection('transactions').doc(tx.hash).set(tx);
    }
    
    return blockData;
}

// Initialize blockchain
async function initializeBlockchain() {
    try {
        // Check if genesis block exists
        const genesisBlock = await db.collection('blocks').doc('block-0').get();
        
        if (!genesisBlock.exists) {
            // Create genesis block
            const genesisData = {
                blockNumber: 0,
                previousHash: '0'.repeat(64),
                transactions: [],
                timestamp: new Date().toISOString(),
                nonce: 0,
                miner: 'Genesis',
                difficulty: '0x3ffffff',
                size: '0 transactions',
                hash: sha256('genesis')
            };
            
            await db.collection('blocks').doc('block-0').set(genesisData);
            console.log('Genesis block created');
        }
        
        // Get latest block
        const latestBlock = await db.collection('blocks')
            .orderBy('blockNumber', 'desc')
            .limit(1)
            .get();
        
        if (!latestBlock.empty) {
            currentBlockNumber = latestBlock.docs[0].data().blockNumber;
        }
        
        // Get pending transactions count
        const pendingTxs = await db.collection('transactions')
            .where('blockNumber', '==', null)
            .get();
        
        currentBlockSize = pendingTxs.size;
        currentBlockTransactions = pendingTxs.docs.map(doc => doc.data());
        
        blockchainInitialized = true;
        console.log('Blockchain initialized. Current block:', currentBlockNumber);
        
    } catch (error) {
        console.error('Error initializing blockchain:', error);
    }
}

// Process new transaction
async function processTransaction(txData) {
    if (!blockchainInitialized) {
        await initializeBlockchain();
    }
    
    // Generate transaction hash
    txData.hash = generateTransactionHash(txData);
    txData.timestamp = new Date().toISOString();
    txData.status = 'pending';
    txData.confirmations = 0;
    
    // Store transaction
    await db.collection('transactions').doc(txData.hash).set(txData);
    
    // Add to current block
    currentBlockTransactions.push(txData);
    currentBlockSize++;
    
    // Check if block is full
    if (currentBlockSize >= BLOCK_CAPACITY) {
        // Get previous block hash
        const previousBlock = await db.collection('blocks')
            .doc(`block-${currentBlockNumber}`)
            .get();
        
        const previousHash = previousBlock.exists ? previousBlock.data().hash : '0'.repeat(64);
        
        // Create new block
        const newBlock = await createNewBlock(currentBlockTransactions, previousHash);
        
        // Update transactions status
        for (const tx of currentBlockTransactions) {
            await db.collection('transactions').doc(tx.hash).update({
                status: 'confirmed',
                blockNumber: newBlock.blockNumber,
                blockHash: newBlock.hash,
                confirmations: 1
            });
        }
        
        // Reset for next block
        currentBlockTransactions = [];
        currentBlockSize = 0;
        
        console.log(`New block created: #${newBlock.blockNumber} with ${newBlock.transactions.length} transactions`);
        
        // Trigger UI updates
        updateBlockchainStats();
        loadLatestBlocks();
        loadAllTransactions();
    }
    
    return txData.hash;
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
    await initializeBlockchain();
    
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const blockResult = document.getElementById('block-result');
    const addressResult = document.getElementById('address-result');
    const transactionResult = document.getElementById('transaction-result');
    const allTransactionsContainer = document.getElementById('all-transactions');
    const allBlocksContainer = document.getElementById('all-blocks');
    const paginationContainer = document.getElementById('pagination');
    const blockPaginationContainer = document.getElementById('block-pagination');
    
    let allTransactions = [];
    let allBlocks = [];
    let currentPage = 1;
    let currentBlockPage = 1;
    const itemsPerPage = 10;
    
    // Setup search
    searchBtn.addEventListener('click', searchBlockchain);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchBlockchain();
    });
    
    // Setup search options
    document.querySelectorAll('.search-option').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.search-option').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    async function searchBlockchain() {
        const query = searchInput.value.trim();
        if (!query) return;
        
        loading.style.display = 'flex';
        errorMessage.style.display = 'none';
        blockResult.style.display = 'none';
        addressResult.style.display = 'none';
        transactionResult.style.display = 'none';
        
        try {
            // Check if it's a block number
            if (/^\d+$/.test(query)) {
                await displayBlock(parseInt(query));
            }
            // Check if it's a transaction hash
            else if (query.length === 64 && /^[a-fA-F0-9]+$/.test(query)) {
                await displayTransaction(query);
            }
            // Check if it's an address
            else if (query.startsWith('0x') && query.length === 42) {
                await displayAddress(query);
            }
            else {
                // Try to search in all fields
                const txDoc = await db.collection('transactions').doc(query).get();
                if (txDoc.exists) {
                    await displayTransaction(query);
                } else {
                    // Search by partial match
                    await searchPartial(query);
                }
            }
        } catch (error) {
            console.error('Search error:', error);
            showError();
        } finally {
            loading.style.display = 'none';
        }
    }
    
    async function displayBlock(blockNumber) {
        const blockDoc = await db.collection('blocks').doc(`block-${blockNumber}`).get();
        
        if (!blockDoc.exists) {
            showError();
            return;
        }
        
        const block = blockDoc.data();
        
        document.getElementById('block-header').textContent = `Block #${block.blockNumber}`;
        document.getElementById('block-number').textContent = block.blockNumber;
        document.getElementById('block-hash').textContent = block.hash;
        document.getElementById('block-prev-hash').textContent = block.previousHash;
        document.getElementById('block-timestamp').textContent = formatTimestamp(block.timestamp);
        document.getElementById('block-transactions-count').textContent = block.transactions ? block.transactions.length : 0;
        document.getElementById('block-miner').textContent = block.miner;
        document.getElementById('block-difficulty').textContent = block.difficulty;
        document.getElementById('block-size').textContent = block.size;
        
        // Display transactions in block
        const transactionsContainer = document.getElementById('block-transactions');
        transactionsContainer.innerHTML = '';
        
        if (block.transactions && block.transactions.length > 0) {
            for (const tx of block.transactions) {
                const txDoc = await db.collection('transactions').doc(tx.hash || tx).get();
                if (txDoc.exists) {
                    addTransactionToContainer(txDoc, transactionsContainer, true);
                }
            }
        } else {
            transactionsContainer.innerHTML = '<p>No transactions in this block</p>';
        }
        
        blockResult.style.display = 'block';
        window.scrollTo({ top: blockResult.offsetTop, behavior: 'smooth' });
    }
    
    async function displayTransaction(txHash) {
        const txDoc = await db.collection('transactions').doc(txHash).get();
        
        if (!txDoc.exists) {
            showError();
            return;
        }
        
        const tx = txDoc.data();
        
        // Update UI
        document.getElementById('tx-hash-header').textContent = txHash;
        document.getElementById('tx-hash').textContent = txHash;
        document.getElementById('tx-status').textContent = tx.status || 'Confirmed';
        document.getElementById('tx-timestamp').textContent = formatTimestamp(tx.timestamp);
        document.getElementById('tx-from').textContent = tx.from || '--';
        document.getElementById('tx-to').textContent = tx.to || '--';
        document.getElementById('tx-amount').textContent = tx.amount ? `${tx.amount} XYZ` : '--';
        document.getElementById('tx-gas').textContent = tx.gasFee ? `${tx.gasFee} SOL` : '--';
        document.getElementById('tx-type').textContent = tx.transactionType?.toUpperCase() || '--';
        document.getElementById('tx-nonce').textContent = tx.nonce || '--';
        document.getElementById('tx-block-number').textContent = tx.blockNumber || 'Pending';
        document.getElementById('tx-block-hash').textContent = tx.blockHash || '--';
        
        // Generate permalink
        const permalink = `${window.location.origin}${window.location.pathname}?tx=${txHash}`;
        document.getElementById('tx-permalink').href = permalink;
        
        // Make addresses clickable
        document.getElementById('tx-from').addEventListener('click', () => {
            searchInput.value = tx.from;
            searchBlockchain();
        });
        
        document.getElementById('tx-to').addEventListener('click', () => {
            searchInput.value = tx.to;
            searchBlockchain();
        });
        
        // Setup copy link button
        document.getElementById('copy-tx-link').addEventListener('click', () => {
            navigator.clipboard.writeText(permalink);
            showToast('Transaction link copied to clipboard!');
        });
        
        transactionResult.style.display = 'block';
        window.scrollTo({ top: transactionResult.offsetTop, behavior: 'smooth' });
    }
    
    async function displayAddress(address) {
        // Get address transactions
        const txsFrom = await db.collection('transactions')
            .where('from', '==', address)
            .orderBy('timestamp', 'desc')
            .get();
        
        const txsTo = await db.collection('transactions')
            .where('to', '==', address)
            .orderBy('timestamp', 'desc')
            .get();
        
        const allTxs = [...txsFrom.docs, ...txsTo.docs];
        
        // Calculate balances
        let xyzBalance = 0;
        let solBalance = 0;
        
        txsTo.forEach(doc => {
            const tx = doc.data();
            xyzBalance += parseFloat(tx.amount || 0);
            solBalance += parseFloat(tx.gasFee || 0);
        });
        
        txsFrom.forEach(doc => {
            const tx = doc.data();
            xyzBalance -= parseFloat(tx.amount || 0);
            solBalance -= parseFloat(tx.gasFee || 0);
        });
        
        // Update UI
        document.getElementById('address-header').textContent = address;
        document.getElementById('xyz-balance').textContent = `${xyzBalance.toFixed(4)} XYZ`;
        document.getElementById('sol-balance').textContent = `${solBalance.toFixed(4)} SOL`;
        document.getElementById('address-tx-count').textContent = allTxs.length;
        
        // Display transactions
        const container = document.getElementById('address-transactions');
        container.innerHTML = '';
        
        if (allTxs.length === 0) {
            container.innerHTML = '<p>No transactions found for this address</p>';
        } else {
            allTxs.slice(0, 10).forEach(doc => {
                addTransactionToContainer(doc, container);
            });
        }
        
        // Setup copy address button
        document.getElementById('copy-address').addEventListener('click', () => {
            navigator.clipboard.writeText(address);
            showToast('Address copied to clipboard!');
        });
        
        addressResult.style.display = 'block';
        window.scrollTo({ top: addressResult.offsetTop, behavior: 'smooth' });
    }
    
    async function searchPartial(query) {
        // Try to find in blocks
        if (/^\d+$/.test(query)) {
            await displayBlock(parseInt(query));
            return;
        }
        
        // Try to find in addresses (partial match)
        const addressTxs = await db.collection('transactions')
            .where('from', '>=', query)
            .where('from', '<=', query + '\uf8ff')
            .limit(5)
            .get();
        
        if (!addressTxs.empty) {
            searchInput.value = addressTxs.docs[0].data().from;
            await displayAddress(addressTxs.docs[0].data().from);
            return;
        }
        
        showError();
    }
    
    function addTransactionToContainer(doc, container, isInBlock = false) {
        const tx = doc.data();
        const txId = doc.id;
        
        const div = document.createElement('div');
        div.className = isInBlock ? 'block-transaction-item' : 'transaction-item';
        
        const typeClass = tx.transactionType === 'sent' ? 'sent' : 'received';
        const txLink = `${window.location.origin}${window.location.pathname}?tx=${txId}`;
        
        div.innerHTML = `
            <div class="transaction-row">
                <div class="transaction-data-item">
                    <span class="transaction-data-label">Hash:</span>
                    <a href="${txLink}" class="tx-link" target="_blank">${txId.substring(0, 16)}...</a>
                </div>
                <div class="transaction-data-item">
                    <span class="transaction-data-label">Time:</span>
                    <span class="transaction-data-value">${formatTimestamp(tx.timestamp)}</span>
                </div>
                <div class="transaction-data-item">
                    <span class="transaction-data-label">${tx.transactionType === 'sent' ? 'To:' : 'From:'}</span>
                    <span class="transaction-data-value">${tx.transactionType === 'sent' ? (tx.to?.substring(0, 12) + '...' || '--') : (tx.from?.substring(0, 12) + '...' || '--')}</span>
                </div>
                <div class="transaction-data-item">
                    <span class="transaction-data-label">Amount:</span>
                    <span class="transaction-data-value">${tx.amount || '--'} XYZ</span>
                </div>
                <div class="transaction-data-item">
                    <span class="transaction-data-label">Block:</span>
                    <span class="transaction-data-value">${tx.blockNumber || 'Pending'}</span>
                </div>
                <div class="transaction-type ${typeClass}">${tx.transactionType?.toUpperCase() || '--'}</div>
            </div>
        `;
        
        div.addEventListener('click', async () => {
            searchInput.value = txId;
            await displayTransaction(txId);
        });
        
        container.appendChild(div);
    }
    
    async function loadAllTransactions() {
        try {
            const querySnapshot = await db.collection('transactions')
                .orderBy('timestamp', 'desc')
                .limit(100)
                .get();
            
            allTransactions = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            updateTransactionsDisplay();
            updatePagination();
        } catch (err) {
            console.error('Error loading transactions:', err);
        }
    }
    
    async function loadLatestBlocks() {
        try {
            const querySnapshot = await db.collection('blocks')
                .orderBy('blockNumber', 'desc')
                .limit(10)
                .get();
            
            allBlocks = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            updateBlocksDisplay();
        } catch (err) {
            console.error('Error loading blocks:', err);
        }
    }
    
    function updateTransactionsDisplay() {
        allTransactionsContainer.innerHTML = '';
        
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const transactionsToShow = allTransactions.slice(startIndex, endIndex);
        
        if (transactionsToShow.length === 0) {
            allTransactionsContainer.innerHTML = '<p>No transactions found</p>';
            return;
        }
        
        transactionsToShow.forEach(tx => {
            const div = document.createElement('div');
            div.className = 'transaction-item';
            
            const typeClass = tx.transactionType === 'sent' ? 'sent' : 'received';
            const txLink = `${window.location.origin}${window.location.pathname}?tx=${tx.id}`;
            
            div.innerHTML = `
                <div class="transaction-row">
                    <div class="transaction-data-item">
                        <span class="transaction-data-label">Hash:</span>
                        <a href="${txLink}" class="tx-link" target="_blank">${tx.id.substring(0, 16)}...</a>
                    </div>
                    <div class="transaction-data-item">
                        <span class="transaction-data-label">Time:</span>
                        <span class="transaction-data-value">${formatTimestamp(tx.timestamp)}</span>
                    </div>
                    <div class="transaction-data-item">
                        <span class="transaction-data-label">From:</span>
                        <span class="transaction-data-value">${tx.from?.substring(0, 12)}...</span>
                    </div>
                    <div class="transaction-data-item">
                        <span class="transaction-data-label">To:</span>
                        <span class="transaction-data-value">${tx.to?.substring(0, 12)}...</span>
                    </div>
                    <div class="transaction-data-item">
                        <span class="transaction-data-label">Amount:</span>
                        <span class="transaction-data-value">${tx.amount} XYZ</span>
                    </div>
                    <div class="transaction-data-item">
                        <span class="transaction-data-label">Block:</span>
                        <span class="transaction-data-value">${tx.blockNumber || 'Pending'}</span>
                    </div>
                    <div class="transaction-type ${typeClass}">${tx.transactionType?.toUpperCase()}</div>
                </div>
            `;
            
            div.addEventListener('click', async () => {
                searchInput.value = tx.id;
                await displayTransaction(tx.id);
            });
            
            allTransactionsContainer.appendChild(div);
        });
    }
    
    function updateBlocksDisplay() {
        allBlocksContainer.innerHTML = '';
        
        if (allBlocks.length === 0) {
            allBlocksContainer.innerHTML = '<p>No blocks found</p>';
            return;
        }
        
        allBlocks.forEach(block => {
            const div = document.createElement('div');
            div.className = 'block-item';
            
            div.innerHTML = `
                <div class="block-header">
                    <div class="block-number">Block #${block.blockNumber}</div>
                    <div class="block-hash">${block.hash.substring(0, 16)}...</div>
                </div>
                <div class="block-info">
                    <div class="block-info-item">
                        <div class="block-info-label">Transactions</div>
                        <div class="block-info-value">${block.transactions?.length || 0}</div>
                    </div>
                    <div class="block-info-item">
                        <div class="block-info-label">Timestamp</div>
                        <div class="block-info-value">${formatTimestamp(block.timestamp)}</div>
                    </div>
                    <div class="block-info-item">
                        <div class="block-info-label">Miner</div>
                        <div class="block-info-value">${block.miner}</div>
                    </div>
                    <div class="block-info-item">
                        <div class="block-info-label">Size</div>
                        <div class="block-info-value">${block.size}</div>
                    </div>
                </div>
                <div class="block-info">
                    <div class="block-info-item">
                        <div class="block-info-label">Previous Hash</div>
                        <div class="block-info-value">${block.previousHash.substring(0, 16)}...</div>
                    </div>
                </div>
            `;
            
            div.addEventListener('click', async () => {
                searchInput.value = block.blockNumber;
                await displayBlock(block.blockNumber);
            });
            
            allBlocksContainer.appendChild(div);
        });
    }
    
    function updatePagination() {
        paginationContainer.innerHTML = '';
        
        const totalPages = Math.ceil(allTransactions.length / itemsPerPage);
        
        if (totalPages <= 1) return;
        
        // Add Previous button
        if (currentPage > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'page-btn';
            prevBtn.textContent = 'Previous';
            prevBtn.addEventListener('click', () => {
                currentPage--;
                updateTransactionsDisplay();
                updatePagination();
                window.scrollTo({ top: allTransactionsContainer.offsetTop, behavior: 'smooth' });
            });
            paginationContainer.appendChild(prevBtn);
        }
        
        // Display page numbers
        let startPage = Math.max(1, currentPage - 1);
        let endPage = Math.min(totalPages, currentPage + 1);
        
        if (currentPage === 1) {
            endPage = Math.min(totalPages, 3);
        } else if (currentPage === totalPages) {
            startPage = Math.max(1, totalPages - 2);
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', () => {
                currentPage = i;
                updateTransactionsDisplay();
                updatePagination();
                window.scrollTo({ top: allTransactionsContainer.offsetTop, behavior: 'smooth' });
            });
            paginationContainer.appendChild(pageBtn);
        }
        
        // Add Next button
        if (currentPage < totalPages) {
            const nextBtn = document.createElement('button');
            nextBtn.className = 'page-btn';
            nextBtn.textContent = 'Next';
            nextBtn.addEventListener('click', () => {
                currentPage++;
                updateTransactionsDisplay();
                updatePagination();
                window.scrollTo({ top: allTransactionsContainer.offsetTop, behavior: 'smooth' });
            });
            paginationContainer.appendChild(nextBtn);
        }
    }
    
    async function updateBlockchainStats() {
        try {
            // Get total blocks
            const blocksSnapshot = await db.collection('blocks').get();
            document.getElementById('total-blocks').textContent = blocksSnapshot.size;
            document.getElementById('block-height').textContent = currentBlockNumber;
            
            // Get total transactions
            const txsSnapshot = await db.collection('transactions').get();
            document.getElementById('total-tx').textContent = txsSnapshot.size;
            
            // Calculate unique addresses
            const addressSet = new Set();
            let totalXYZ = 0;
            
            txsSnapshot.forEach(doc => {
                const tx = doc.data();
                if (tx.from) addressSet.add(tx.from);
                if (tx.to) addressSet.add(tx.to);
                totalXYZ += parseFloat(tx.amount || 0);
            });
            
            document.getElementById('active-addresses').textContent = addressSet.size;
            document.getElementById('xyz-circulation').textContent = `${totalXYZ.toLocaleString()} XYZ`;
            
        } catch (err) {
            console.error('Error updating stats:', err);
        }
    }
    
    function formatTimestamp(timestamp) {
        if (!timestamp) return '--';
        const date = new Date(timestamp);
        return date.toLocaleString();
    }
    
    function showError() {
        errorMessage.style.display = 'block';
    }
    
    function showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
    
    // Initialize the blockchain and load data
    await updateBlockchainStats();
    await loadLatestBlocks();
    await loadAllTransactions();
    
    // Check URL for auto-search
    checkURLForAutoSearch();
});

// Check URL parameters for auto-search
function checkURLForAutoSearch() {
    const urlParams = new URLSearchParams(window.location.search);
    const txHash = urlParams.get('tx');
    const blockNumber = urlParams.get('block');
    const address = urlParams.get('address');
    
    if (txHash) {
        document.getElementById('search-input').value = txHash;
        setTimeout(() => document.getElementById('search-btn').click(), 500);
    } else if (blockNumber) {
        document.getElementById('search-input').value = blockNumber;
        setTimeout(() => document.getElementById('search-btn').click(), 500);
    } else if (address) {
        document.getElementById('search-input').value = address;
        setTimeout(() => document.getElementById('search-btn').click(), 500);
    }
}

// Notification system (keep from original)
const walletNotificationContainer = document.getElementById('walletNotification');
const showTime = 5000;
let notificationQueue = [];
let currentIndex = 0;
let isShowing = false;

function showNextNotification() {
    if (notificationQueue.length === 0) {
        isShowing = false;
        return;
    }

    const data = notificationQueue[currentIndex];
    walletNotificationContainer.innerHTML = `
        <img src="${data.photoLink || 'https://placehold.co/40x40/cccccc/000000?text=NF'}" class="wallet-photo" onerror="this.onerror=null;this.src='https://placehold.co/40x40/cccccc/000000?text=NF';">
        <span>${data.title || 'New Notification'}</span>
    `;

    walletNotificationContainer.onclick = () => {
        window.location.href = 'xyzNotification.html'; 
    };

    walletNotificationContainer.classList.add('show');

    setTimeout(() => {
        walletNotificationContainer.classList.remove('show');
        setTimeout(() => {
            currentIndex = (currentIndex + 1) % notificationQueue.length;
            showNextNotification();
        }, 300);
    }, showTime);
}

function startNotificationLoop() {
    if (!isShowing && notificationQueue.length > 0) {
        isShowing = true;
        showNextNotification();
    }
}

function setupNotificationListener() {
    db.collection("XYZnotifications")
        .orderBy("notificationNumber", "desc")
        .limit(10)
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    notificationQueue.push({
                        id: change.doc.id,
                        title: data.title,
                        photoLink: data.photoLink
                    });
                }
            });
            startNotificationLoop();
        }, (error) => {
            console.error("Notification listener error:", error);
        });
}

document.addEventListener('DOMContentLoaded', setupNotificationListener);

// Crypto ticker (keep from original)
const cryptos = {
    "bitcoin": { symbol: "BTC", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/bitcoin-btc-logo28129278199549210072979.jpg" },
    "ethereum": { symbol: "ETH", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/ethereum-eth-logo6464784847528636048.png" },
    "litecoin": { symbol: "LTC", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/litecoin-ltc-logo8675545178060996964.png" },
    "solana": { symbol: "SOL", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/solana-sol-logo281298285079945615734995.jpg" },
    "dash": { symbol: "DASH", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/dash-dash-logo332793562558391043.png" },
    "dogecoin": { symbol: "DOGE", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/dogecoin-doge-logo2539560636730686420.png" },
    "binancecoin": { symbol: "BNB", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/bnb-bnb-logo259338065244576686.png" },
    "tether": { symbol: "USDT", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/tether-usdt-logo8137853041787771395.png" },
    "metis-token": { symbol: "METIS", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/metisdao-metis-logo271474949307854164.png" },
    "manta-network": { symbol: "MANTA", logo: "https://xyz1a1.wordpress.com/wp-content/uploads/2025/06/retouch_20250611201843848177814195853987194.png" }
};

let lastPrices = {};

function fetchPrices() {  
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,litecoin,solana,dash,dogecoin,binancecoin,tether,metis-token,manta-network&vs_currencies=usd&include_24hr_change=true')  
        .then(response => response.json())  
        .then(data => {  
            const ticker = document.getElementById('crypto-items');  
            const tickerClone = document.getElementById('crypto-items-clone');
            ticker.innerHTML = '';  
            tickerClone.innerHTML = ''; // Clear clone as well
            
            const fragment = document.createDocumentFragment(); // Use fragment for performance
            
            for (const [id, crypto] of Object.entries(cryptos)) {  
                const price = data[id].usd;  
                const change24h = data[id].usd_24h_change;
                const lastPrice = lastPrices[crypto.symbol] || price;  
                const priceClass = price > lastPrice ? 'price-up' : 'price-down';  
                const changeClass = change24h >= 0 ? 'price-up' : 'price-down';
                const arrow = change24h >= 0 ? '↑' : '↓';
                
                const cryptoElement = document.createElement('div');  
                cryptoElement.className = 'crypto';  
                cryptoElement.innerHTML = `
                    <div class="crypto-logo">
                        <img src="${crypto.logo}" alt="${crypto.symbol}" onerror="this.onerror=null;this.src='https://placehold.co/32x32/cccccc/000000?text=${crypto.symbol}';">
                    </div>
                    <div class="crypto-info">
                        <div class="crypto-symbol">${crypto.symbol}</div>
                        <div class="crypto-price ${priceClass}">$${price.toLocaleString()}</div>
                        <div class="price-change ${changeClass}">
                            <span class="arrow">${arrow}</span>
                            ${Math.abs(change24h).toFixed(2)}%
                        </div>
                    </div>
                `;
                fragment.appendChild(cryptoElement);  
                lastPrices[crypto.symbol] = price;  
            }  
            ticker.appendChild(fragment.cloneNode(true)); // Append to original
            tickerClone.appendChild(fragment.cloneNode(true)); // Append to clone
        })  
        .catch(error => console.error('Error fetching prices:', error));  
}  

fetchPrices();  
setInterval(fetchPrices, 120000); // Update every 120 seconds

// Helper function to add sample transactions (for testing)
async function addSampleTransaction() {
    const sampleTx = {
        from: '0x742d35Cc6634C0532925a3b844Bc9e0BBE863C03',
        to: '0x53D284357ec70cE289D6D64134DfAc8E511c8a3D',
        amount: (Math.random() * 10).toFixed(4),
        gasFee: (Math.random() * 0.01).toFixed(4),
        transactionType: Math.random() > 0.5 ? 'sent' : 'received',
        nonce: Math.floor(Math.random() * 10000),
        senderEmail: 'user' + Math.floor(Math.random() * 1000) + '@xyz.com',
        receiverEmail: 'user' + Math.floor(Math.random() * 1000) + '@xyz.com'
    };
    
    const txHash = await processTransaction(sampleTx);
    console.log('Sample transaction added:', txHash);
}

// Uncomment to add sample transactions automatically (for testing)
// setInterval(addSampleTransaction, 30000); // Add a transaction every 30 seconds
