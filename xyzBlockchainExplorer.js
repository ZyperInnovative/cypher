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
    const functions = firebase.functions();
// Add these functions to xyzBlockchainExplorer-1A1-shaBlock (1).js

// SHA256 Implementation
async function sha256(message) {
    // Convert message to Uint8Array
    const msgBuffer = new TextEncoder().encode(message);
    
    // Hash the message
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    
    // Convert ArrayBuffer to Array
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    // Convert bytes to hex string
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
}

// Blockchain Class
class Blockchain {
    constructor() {
        this.currentBlock = null;
        this.pendingTransactions = [];
        this.maxTransactionsPerBlock = 100;
        this.difficulty = 4; // Number of leading zeros required
    }

    // Create new block
    async createBlock(transactions, previousHash = '0'.repeat(64)) {
        const timestamp = new Date().toISOString();
        const height = await this.getNextBlockHeight();
        
        // Calculate Merkle Root
        const merkleRoot = await this.calculateMerkleRoot(transactions);
        
        const block = {
            height,
            timestamp,
            transactions,
            previousHash,
            merkleRoot,
            nonce: 0,
            difficulty: this.difficulty,
            miner: 'xyz-miner-pool',
            blockHash: ''
        };

        // Mine the block (Proof of Work)
        block.blockHash = await this.mineBlock(block);
        
        return block;
    }

    // Mine block (Proof of Work)
    async mineBlock(block) {
        let hash = '';
        let nonce = 0;
        const prefix = '0'.repeat(this.difficulty);

        while (true) {
            const blockData = JSON.stringify({
                ...block,
                nonce
            });
            
            hash = await sha256(blockData);
            
            if (hash.startsWith(prefix)) {
                block.nonce = nonce;
                break;
            }
            
            nonce++;
            
            // Add small delay to prevent blocking
            if (nonce % 10000 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        return hash;
    }

    // Calculate Merkle Root
    async calculateMerkleRoot(transactions) {
        if (transactions.length === 0) {
            return await sha256('empty');
        }

        if (transactions.length === 1) {
            return await sha256(JSON.stringify(transactions[0]));
        }

        // Recursively calculate Merkle Root
        const hashPairs = [];
        for (let i = 0; i < transactions.length; i += 2) {
            const left = JSON.stringify(transactions[i]);
            const right = i + 1 < transactions.length ? JSON.stringify(transactions[i + 1]) : left;
            
            const pairHash = await sha256(left + right);
            hashPairs.push(pairHash);
        }

        return await this.calculateMerkleRoot(hashPairs);
    }

    // Get next block height
    async getNextBlockHeight() {
        try {
            const blocksSnapshot = await db.collection("blocks")
                .orderBy("height", "desc")
                .limit(1)
                .get();
            
            if (blocksSnapshot.empty) {
                return 0;
            }
            
            const lastBlock = blocksSnapshot.docs[0].data();
            return lastBlock.height + 1;
        } catch (error) {
            console.error("Error getting block height:", error);
            return 0;
        }
    }

    // Add transaction to pending pool
    addTransaction(transaction) {
        this.pendingTransactions.push(transaction);
        
        // If we have enough transactions, create a block
        if (this.pendingTransactions.length >= this.maxTransactionsPerBlock) {
            this.createBlockAndStore();
        }
    }

    // Create and store block
    async createBlockAndStore() {
        if (this.pendingTransactions.length === 0) return;

        // Get previous hash
        let previousHash = '0'.repeat(64);
        try {
            const lastBlockSnapshot = await db.collection("blocks")
                .orderBy("height", "desc")
                .limit(1)
                .get();
            
            if (!lastBlockSnapshot.empty) {
                const lastBlock = lastBlockSnapshot.docs[0].data();
                previousHash = lastBlock.blockHash;
            }
        } catch (error) {
            console.error("Error getting last block:", error);
        }

        // Create new block
        const transactionsToMine = this.pendingTransactions.slice(0, this.maxTransactionsPerBlock);
        const newBlock = await this.createBlock(transactionsToMine, previousHash);

        // Store block in Firebase
        try {
            await db.collection("blocks").doc(newBlock.blockHash).set({
                ...newBlock,
                storedAt: new Date().toISOString()
            });

            // Update transaction references with block hash
            const batch = db.batch();
            for (const tx of newBlock.transactions) {
                const txRef = db.collection("blockchain").doc(tx.id || tx.hash);
                batch.update(txRef, {
                    blockHash: newBlock.blockHash,
                    blockHeight: newBlock.height,
                    confirmedAt: new Date().toISOString()
                });
            }
            await batch.commit();

            // Remove mined transactions from pending pool
            this.pendingTransactions = this.pendingTransactions.slice(this.maxTransactionsPerBlock);

            console.log(`Block ${newBlock.height} mined successfully!`);
            return newBlock;
        } catch (error) {
            console.error("Error storing block:", error);
            return null;
        }
    }

    // Validate block
    async validateBlock(block) {
        // Verify block hash
        const blockData = JSON.stringify({
            ...block,
            nonce: block.nonce
        });
        
        const calculatedHash = await sha256(blockData);
        
        if (calculatedHash !== block.blockHash) {
            return false;
        }

        // Verify difficulty
        if (!block.blockHash.startsWith('0'.repeat(block.difficulty))) {
            return false;
        }

        // Verify Merkle Root
        const calculatedMerkleRoot = await this.calculateMerkleRoot(block.transactions);
        if (calculatedMerkleRoot !== block.merkleRoot) {
            return false;
        }

        return true;
    }
}

// Initialize Blockchain
const blockchain = new Blockchain();

// Function to generate transaction hash
async function generateTransactionHash(transactionData) {
    const dataString = JSON.stringify({
        from: transactionData.from,
        to: transactionData.to,
        amount: transactionData.amount,
        timestamp: transactionData.timestamp || new Date().toISOString(),
        nonce: Math.random().toString(36).substring(2, 15)
    });
    
    return await sha256(dataString);
}

// Function to generate shareable transaction link
function generateTransactionLink(transactionId) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?tx=${transactionId}`;
}

// Function to generate shareable block link
function generateBlockLink(blockHash) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?block=${blockHash}`;
}

// Function to copy to clipboard
function copyToClipboard(text, elementId = null) {
    navigator.clipboard.writeText(text).then(() => {
        if (elementId) {
            const element = document.getElementById(elementId);
            if (element) {
                const originalText = element.textContent;
                element.textContent = 'Copied!';
                setTimeout(() => {
                    element.textContent = originalText;
                }, 2000);
            }
        }
        // Show toast notification
        showToast('Copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showToast('Failed to copy', true);
    });
}

// Toast notification function
function showToast(message, isError = false) {
    // Remove existing toast
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }

    // Create new toast
    const toast = document.createElement('div');
    toast.className = `toast-notification ${isError ? 'toast-error' : 'toast-success'}`;
    toast.textContent = message;
    
    // Style the toast
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.backgroundColor = isError ? '#ef4444' : '#10b981';
    toast.style.color = 'white';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    toast.style.zIndex = '10000';
    toast.style.fontSize = '14px';
    toast.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Update DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async () => {
    // ... (existing code) ...

    // Load blockchain data
    loadAllTransactions();
    loadNetworkStats();
    loadBlocks();
    
    // Start mining process for pending transactions
    startMiningProcess();
    
    // Handle URL parameters
    handleURLParameters();
});

// Function to load blocks
async function loadBlocks(page = 1, itemsPerPage = 10) {
    try {
        const blocksList = document.getElementById('blocks-list');
        if (!blocksList) return;

        const totalSnapshot = await db.collection("blocks").count().get();
        const totalBlocks = totalSnapshot.data().count;
        
        document.getElementById('total-blocks').textContent = totalBlocks;
        document.getElementById('block-height').textContent = totalBlocks > 0 ? totalBlocks - 1 : '0';

        // Get blocks with pagination
        let query = db.collection("blocks")
            .orderBy("height", "desc");
        
        const snapshot = await query.limit(itemsPerPage).get();
        
        blocksList.innerHTML = '';
        
        if (snapshot.empty) {
            blocksList.innerHTML = '<p>No blocks found. Blockchain is empty.</p>';
            return;
        }
        
        snapshot.forEach(doc => {
            const block = doc.data();
            const blockElement = createBlockElement(block);
            blocksList.appendChild(blockElement);
        });

        // Update block pagination
        updateBlockPagination(totalBlocks, page, itemsPerPage);
    } catch (error) {
        console.error("Error loading blocks:", error);
    }
}

// Function to create block element
function createBlockElement(block) {
    const div = document.createElement('div');
    div.className = 'block-item';
    
    div.innerHTML = `
        <div class="block-header">
            <div class="block-height">Block #${block.height}</div>
            <div class="block-timestamp">${formatTimestamp(block.timestamp)}</div>
        </div>
        <div class="block-body">
            <div class="block-data-item">
                <div class="block-data-label">Block Hash</div>
                <div class="hash-display">
                    <span class="block-data-value">${block.blockHash.substring(0, 24)}...</span>
                    <button class="copy-btn" onclick="copyToClipboard('${block.blockHash}', 'copy-block-${block.height}')" id="copy-block-${block.height}">Copy</button>
                </div>
            </div>
            <div class="block-data-item">
                <div class="block-data-label">Previous Hash</div>
                <div class="block-data-value">${block.previousHash === '0'.repeat(64) ? 'Genesis Block' : block.previousHash.substring(0, 24) + '...'}</div>
            </div>
            <div class="block-data-item">
                <div class="block-data-label">Transactions</div>
                <div class="block-data-value">${block.transactions ? block.transactions.length : 0} tx</div>
            </div>
            <div class="block-data-item">
                <div class="block-data-label">Miner</div>
                <div class="block-data-value">${block.miner || 'Unknown'}</div>
            </div>
        </div>
        <div class="block-miner">
            <span class="miner-label">Block Link:</span>
            <span class="block-link" onclick="window.location.href='${generateBlockLink(block.blockHash)}'">
                ${window.location.origin + window.location.pathname}?block=${block.blockHash.substring(0, 16)}...
            </span>
            <button class="copy-btn" onclick="copyToClipboard('${generateBlockLink(block.blockHash)}')">Copy Link</button>
        </div>
    `;
    
    div.addEventListener('click', () => {
        displayBlockDetails(block);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    return div;
}

// Function to display block details
async function displayBlockDetails(block) {
    const blockResult = document.getElementById('block-result');
    if (!blockResult) return;

    // Hide other result containers
    document.getElementById('address-result').style.display = 'none';
    document.getElementById('transaction-result').style.display = 'none';
    
    // Set block details
    document.getElementById('block-hash-header').textContent = block.blockHash;
    document.getElementById('block-height-detail').textContent = block.height;
    document.getElementById('block-hash-detail').textContent = block.blockHash;
    document.getElementById('prev-hash-detail').textContent = block.previousHash;
    document.getElementById('block-timestamp').textContent = formatTimestamp(block.timestamp);
    document.getElementById('block-transaction-count').textContent = block.transactions ? block.transactions.length : 0;
    document.getElementById('merkle-root').textContent = block.merkleRoot;
    document.getElementById('block-nonce').textContent = block.nonce;
    document.getElementById('block-difficulty-detail').textContent = block.difficulty;
    
    // Load block transactions
    const transactionsContainer = document.getElementById('block-transactions');
    transactionsContainer.innerHTML = '';
    
    if (block.transactions && block.transactions.length > 0) {
        // Get full transaction details
        const transactionPromises = block.transactions.map(async tx => {
            if (typeof tx === 'string') {
                // If transaction is stored as ID, fetch it
                const txDoc = await db.collection("blockchain").doc(tx).get();
                return txDoc.exists ? { id: txDoc.id, ...txDoc.data() } : null;
            }
            return tx; // Already has full transaction data
        });
        
        const transactions = (await Promise.all(transactionPromises)).filter(tx => tx !== null);
        
        transactions.forEach(tx => {
            const transactionElement = createTransactionElement(tx, true);
            transactionsContainer.appendChild(transactionElement);
        });
    } else {
        transactionsContainer.innerHTML = '<p>No transactions in this block.</p>';
    }
    
    blockResult.style.display = 'block';
}

// Function to create transaction element with links
function createTransactionElement(tx, showBlockLink = false) {
    const div = document.createElement('div');
    div.className = 'transaction-item';
    
    const typeClass = tx.transactionType === 'sent' ? 'sent' : 'received';
    const transactionLink = generateTransactionLink(tx.id);
    
    div.innerHTML = `
        <div class="transaction-row">
            <div class="transaction-data-item">
                <span class="transaction-data-label">Status:</span>
                <span class="transaction-data-value">${tx.status || 'Confirmed'}</span>
            </div>
            <div class="transaction-data-item">
                <span class="transaction-data-label">Time:</span>
                <span class="transaction-data-value">${formatTimestamp(tx.timestamp)}</span>
            </div>
            <div class="transaction-data-item">
                <span class="transaction-data-label">${tx.transactionType === 'sent' ? 'To:' : 'From:'}</span>
                <span class="transaction-data-value">${tx.transactionType === 'sent' ? (tx.to || '--') : (tx.from || '--')}</span>
            </div>
            <div class="transaction-data-item">
                <span class="transaction-data-label">Amount:</span>
                <span class="transaction-data-value">${tx.amount || '--'} XYZ</span>
            </div>
            <div class="transaction-type ${typeClass}">${tx.transactionType?.toUpperCase() || '--'}</div>
        </div>
        <div class="transaction-hash-container">
            <span class="transaction-hash-label">Transaction Hash:</span>
            <span class="transaction-hash">${tx.id.substring(0, 32)}...</span>
            <button class="copy-btn" onclick="copyToClipboard('${tx.id}', 'copy-tx-${tx.id.substring(0, 8)}')" style="margin-left: 10px;">Copy Hash</button>
        </div>
        <div class="transaction-link-container" style="margin-top: 10px;">
            <span style="font-size: 0.8rem; opacity: 0.7;">Share Link: </span>
            <span class="transaction-link" onclick="window.location.href='${transactionLink}'">
                ${window.location.origin + window.location.pathname}?tx=${tx.id.substring(0, 16)}...
            </span>
            <button class="copy-btn" onclick="copyToClipboard('${transactionLink}')">Copy Link</button>
            ${showBlockLink && tx.blockHash ? `
                <span style="font-size: 0.8rem; opacity: 0.7; margin-left: 10px;">Block: </span>
                <span class="block-link" onclick="window.location.href='${generateBlockLink(tx.blockHash)}'">
                    Block #${tx.blockHeight || '--'}
                </span>
            ` : ''}
        </div>
        ${tx.senderEmail || tx.receiverEmail ? `
        <div class="transaction-data-item" style="margin-top: 5px;">
            <span style="font-size: 0.8rem; opacity: 0.7;">Emails: </span>
            <span style="font-size: 0.8rem;">
                ${tx.senderEmail ? maskEmail(tx.senderEmail) : ''} → ${tx.receiverEmail ? maskEmail(tx.receiverEmail) : ''}
            </span>
        </div>
        ` : ''}
    `;
    
    div.addEventListener('click', async (e) => {
        // Don't trigger if clicking on links or buttons
        if (e.target.tagName === 'BUTTON' || e.target.classList.contains('transaction-link') || e.target.classList.contains('block-link')) {
            return;
        }
        
        // Load transaction details
        searchInput.value = tx.id;
        await searchBlockchain();
        
        const hashElement = document.querySelector('.transaction-hash');
        if (hashElement) {
            hashElement.scrollIntoView({ behavior: 'smooth' });
        }
    });
    
    return div;
}

// Function to update block pagination
function updateBlockPagination(totalBlocks, currentPage, itemsPerPage) {
    const paginationContainer = document.getElementById('block-pagination');
    if (!paginationContainer) return;

    const totalPages = Math.ceil(totalBlocks / itemsPerPage);
    paginationContainer.innerHTML = '';

    // Previous button
    if (currentPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.textContent = 'Previous';
        prevBtn.addEventListener('click', () => {
            loadBlocks(currentPage - 1, itemsPerPage);
        });
        paginationContainer.appendChild(prevBtn);
    }

    // Page numbers
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
        pageBtn.textContent = i;
        pageBtn.addEventListener('click', () => {
            loadBlocks(i, itemsPerPage);
        });
        paginationContainer.appendChild(pageBtn);
    }

    // Next button
    if (currentPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn';
        nextBtn.textContent = 'Next';
        nextBtn.addEventListener('click', () => {
            loadBlocks(currentPage + 1, itemsPerPage);
        });
        paginationContainer.appendChild(nextBtn);
    }
}

// Function to start mining process
async function startMiningProcess() {
    // Check for pending transactions every 30 seconds
    setInterval(async () => {
        try {
            // Get unconfirmed transactions
            const unconfirmedSnapshot = await db.collection("blockchain")
                .where("blockHash", "==", null)
                .limit(100)
                .get();
            
            if (!unconfirmedSnapshot.empty) {
                const unconfirmedTransactions = unconfirmedSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                
                // Add to blockchain pending pool
                unconfirmedTransactions.forEach(tx => {
                    blockchain.addTransaction(tx);
                });
                
                // Try to mine if we have enough transactions
                if (blockchain.pendingTransactions.length >= blockchain.maxTransactionsPerBlock) {
                    await blockchain.createBlockAndStore();
                }
            }
        } catch (error) {
            console.error("Error in mining process:", error);
        }
    }, 30000); // Check every 30 seconds
}

// Function to handle URL parameters
function handleURLParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const txHash = urlParams.get('tx');
    const blockHash = urlParams.get('block');
    
    if (txHash) {
        // Auto-search for transaction
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        
        if (searchInput && searchBtn) {
            searchInput.value = txHash;
            
            // Wait a moment for everything to load, then trigger search
            setTimeout(() => {
                searchBtn.click();
            }, 500);
        }
    } else if (blockHash) {
        // Auto-load block details
        loadBlockByHash(blockHash);
    }
}

// Function to load block by hash
async function loadBlockByHash(blockHash) {
    try {
        const blockDoc = await db.collection("blocks").doc(blockHash).get();
        
        if (blockDoc.exists) {
            displayBlockDetails(blockDoc.data());
        } else {
            // Try to find by partial hash
            const blocksSnapshot = await db.collection("blocks")
                .where("blockHash", ">=", blockHash)
                .where("blockHash", "<=", blockHash + '\uf8ff')
                .limit(1)
                .get();
            
            if (!blocksSnapshot.empty) {
                displayBlockDetails(blocksSnapshot.docs[0].data());
            } else {
                console.log("Block not found");
            }
        }
    } catch (error) {
        console.error("Error loading block:", error);
    }
}

// Function to organize existing data into blocks
async function organizeExistingData() {
    try {
        console.log("Organizing existing blockchain data...");
        
        // Get all transactions without block references
        const unorganizedSnapshot = await db.collection("blockchain")
            .where("blockHash", "==", null)
            .orderBy("timestamp", "asc")
            .get();
        
        if (unorganizedSnapshot.empty) {
            console.log("No unorganized transactions found.");
            return;
        }
        
        const transactions = unorganizedSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        console.log(`Found ${transactions.length} unorganized transactions.`);
        
        // Group transactions into blocks of 100
        const transactionGroups = [];
        for (let i = 0; i < transactions.length; i += 100) {
            transactionGroups.push(transactions.slice(i, i + 100));
        }
        
        console.log(`Creating ${transactionGroups.length} blocks...`);
        
        // Create blocks for each group
        for (let i = 0; i < transactionGroups.length; i++) {
            const group = transactionGroups[i];
            
            // Get previous block hash
            let previousHash = '0'.repeat(64);
            if (i > 0) {
                const lastBlockSnapshot = await db.collection("blocks")
                    .orderBy("height", "desc")
                    .limit(1)
                    .get();
                
                if (!lastBlockSnapshot.empty) {
                    const lastBlock = lastBlockSnapshot.docs[0].data();
                    previousHash = lastBlock.blockHash;
                }
            }
            
            // Create block
            const newBlock = await blockchain.createBlock(group, previousHash);
            newBlock.height = i; // Set height
            
            // Store block
            await db.collection("blocks").doc(newBlock.blockHash).set({
                ...newBlock,
                storedAt: new Date().toISOString()
            });
            
            // Update transactions with block reference
            const batch = db.batch();
            for (const tx of group) {
                const txRef = db.collection("blockchain").doc(tx.id);
                batch.update(txRef, {
                    blockHash: newBlock.blockHash,
                    blockHeight: newBlock.height,
                    confirmedAt: new Date().toISOString()
                });
            }
            await batch.commit();
            
            console.log(`Created block ${i} with ${group.length} transactions`);
            
            // Small delay to prevent overwhelming Firebase
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log("Data organization complete!");
        
        // Reload blocks
        loadBlocks();
        
    } catch (error) {
        console.error("Error organizing data:", error);
    }
}

// Call this function once to organize existing data
// organizeExistingData(); // Uncomment this line to run organization

// Update the searchBlockchain function to handle blocks
async function searchBlockchain() {
    const query = searchInput.value.trim();
    if (!query) return;

    loading.style.display = 'flex';
    errorMessage.style.display = 'none';
    addressResult.style.display = 'none';
    transactionResult.style.display = 'none';
    blockResult.style.display = 'none';

    try {
        // Check if it's a block hash
        const blockDoc = await db.collection("blocks").doc(query).get();
        if (blockDoc.exists) {
            displayBlockDetails(blockDoc.data());
            loading.style.display = 'none';
            return;
        }
        
        // Check for block by partial hash
        const blockSnapshot = await db.collection("blocks")
            .where("blockHash", ">=", query)
            .where("blockHash", "<=", query + '\uf8ff')
            .limit(1)
            .get();
        
        if (!blockSnapshot.empty) {
            displayBlockDetails(blockSnapshot.docs[0].data());
            loading.style.display = 'none';
            return;
        }

        // Check if it's a transaction hash
        const txDoc = await db.collection("blockchain").doc(query).get();
        if (txDoc.exists) {
            displayTransaction(txDoc);
            loading.style.display = 'none';
            return;
        }

        // Search transactions involving the address
        const txsFrom = await db.collection("blockchain")
            .where("from", "==", query)
            .get();
        const txsTo = await db.collection("blockchain")
            .where("to", "==", query)
            .get();

        const combinedDocs = [...txsFrom.docs, ...txsTo.docs];

        if (combinedDocs.length === 0) {
            showError();
            return;
        }

        // Show transaction hashes for results
        const listContainer = document.getElementById('address-result');
        listContainer.innerHTML = `<h3>Transactions for: ${query}</h3>`;
        combinedDocs.forEach(doc => {
            const txId = doc.id;
            const item = document.createElement('div');
            item.textContent = `Transaction Hash: ${txId}`;
            item.className = 'tx-hash-item';
            item.style.cursor = 'pointer';
            item.style.margin = '5px 0';
            item.addEventListener('click', () => {
                displayTransaction(doc);
                const hashElement = document.querySelector('.transaction-hash');
                if (hashElement) {
                    hashElement.scrollIntoView({ behavior: 'smooth' });
                }
            });
            listContainer.appendChild(item);
        });

        listContainer.style.display = 'block';

    } catch (error) {
        console.error("Search error:", error);
        showError();
    } finally {
        loading.style.display = 'none';
    }
}

// Update the displayTransaction function to show block info
function displayTransaction(txDocSnap) {
    const tx = txDocSnap.data();
    document.getElementById('tx-hash-header').textContent = txDocSnap.id;
    document.getElementById('tx-status').textContent = tx.status || (tx.blockHash ? 'Confirmed' : 'Pending');
    document.getElementById('tx-timestamp').textContent = formatTimestamp(tx.timestamp);
    document.getElementById('tx-from').textContent = tx.from || '--';
    document.getElementById('tx-to').textContent = tx.to || '--';
    document.getElementById('tx-amount').textContent = tx.amount ? `${tx.amount} XYZ` : '--';
    document.getElementById('tx-gas').textContent = tx.gasFee ? `${tx.gasFee} SOL` : '--';
    document.getElementById('tx-type').textContent = tx.transactionType?.toUpperCase() || '--';
    
    // Display masked emails
    document.getElementById('tx-sender-email').textContent = tx.senderEmail ? maskEmail(tx.senderEmail) : '--';
    document.getElementById('tx-receiver-email').textContent = tx.receiverEmail ? maskEmail(tx.receiverEmail) : '--';
    
    // Add block information if available
    if (tx.blockHash) {
        const dataGrid = document.querySelector('#transaction-result .data-grid');
        const blockItem = document.createElement('div');
        blockItem.className = 'data-item';
        blockItem.innerHTML = `
            <div class="data-label">Block</div>
            <div class="data-value">
                <span class="block-link" onclick="window.location.href='${generateBlockLink(tx.blockHash)}'">
                    Block #${tx.blockHeight || '--'} (${tx.blockHash.substring(0, 16)}...)
                </span>
                <button class="copy-btn" onclick="copyToClipboard('${generateBlockLink(tx.blockHash)}')" style="margin-left: 5px;">Copy Link</button>
            </div>
        `;
        dataGrid.appendChild(blockItem);
    }
    
    // Add shareable link
    const shareItem = document.createElement('div');
    shareItem.className = 'data-item';
    shareItem.innerHTML = `
        <div class="data-label">Share Link</div>
        <div class="data-value">
            <span class="transaction-link" onclick="window.location.href='${generateTransactionLink(txDocSnap.id)}'">
                ${window.location.origin + window.location.pathname}?tx=${txDocSnap.id.substring(0, 16)}...
            </span>
            <button class="copy-btn" onclick="copyToClipboard('${generateTransactionLink(txDocSnap.id)}')" style="margin-left: 5px;">Copy</button>
        </div>
    `;
    dataGrid.appendChild(shareItem);
    
    transactionResult.style.display = 'block';
}

    // Transaction data and pagination variables
    let allTransactions = [];
    let currentPage = 1;
    const transactionsPerPage = 20;

    // Function to mask email addresses
    function maskEmail(email) {
        if (!email || !email.includes('@')) return 'unknown@xyz.com';
        
        const [localPart, domain] = email.split('@');
        if (localPart.length <= 4) {
            return localPart.charAt(0) + '***@' + domain;
        }
        
        const firstPart = localPart.substring(0, 3);
        const lastPart = localPart.substring(localPart.length - 1);
        return `${firstPart}...${lastPart}@${domain}`;
    }
     

    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', () => {
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        const loading = document.getElementById('loading');
        const errorMessage = document.getElementById('error-message');
        const addressResult = document.getElementById('address-result');
        const transactionResult = document.getElementById('transaction-result');
        const allTransactionsContainer = document.getElementById('all-transactions');
        const paginationContainer = document.getElementById('pagination');

        if (!searchInput || !searchBtn) {
            console.error("Missing HTML elements (searchInput/searchBtn)");
            return;
        }

        searchBtn.addEventListener('click', searchBlockchain);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchBlockchain();
        });

        async function searchBlockchain() {
            const query = searchInput.value.trim();
            if (!query) return;

            loading.style.display = 'flex';
            errorMessage.style.display = 'none';
            addressResult.style.display = 'none';
            transactionResult.style.display = 'none';

            try {
                // If input is a hash, check direct match
                const txDoc = await db.collection("blockchain").doc(query).get();
                if (txDoc.exists) {
                    displayTransaction(txDoc);
                    loading.style.display = 'none';
                    return;
                }

                // Search transactions involving the address
                const txsFrom = await db.collection("blockchain")
                    .where("from", "==", query)
                    .get();
                const txsTo = await db.collection("blockchain")
                    .where("to", "==", query)
                    .get();

                const combinedDocs = [...txsFrom.docs, ...txsTo.docs];

                if (combinedDocs.length === 0) {
                    showError();
                    return;
                }

                // Show transaction hashes for results
                const listContainer = document.getElementById('address-result');
                listContainer.innerHTML = `<h3>Transactions for: ${query}</h3>`;
                combinedDocs.forEach(doc => {
                    const txId = doc.id;
                    const item = document.createElement('div');
                    item.textContent = `Transaction Hash: ${txId}`;
                    item.className = 'tx-hash-item';
                    item.style.cursor = 'pointer';
                    item.style.margin = '5px 0';
                    item.addEventListener('click', () => {
                        displayTransaction(doc);
                        const hashElement = document.querySelector('.transaction-hash');
                        if (hashElement) {
                            hashElement.scrollIntoView({ behavior: 'smooth' });
                        }
                    });
                    listContainer.appendChild(item);
                });

                listContainer.style.display = 'block';

            } catch (error) {
                console.error("Search error:", error);
                showError();
            } finally {
                loading.style.display = 'none';
            }
        }

        function displayTransaction(txDocSnap) {
            const tx = txDocSnap.data();
            document.getElementById('tx-hash-header').textContent = txDocSnap.id;
            document.getElementById('tx-status').textContent = tx.status || '--';
            document.getElementById('tx-timestamp').textContent = formatTimestamp(tx.timestamp);
            document.getElementById('tx-from').textContent = tx.from || '--';
            document.getElementById('tx-to').textContent = tx.to || '--';
            document.getElementById('tx-amount').textContent = tx.amount ? `${tx.amount} XYZ` : '--';
            document.getElementById('tx-gas').textContent = tx.gasFee ? `${tx.gasFee} SOL`: '--';
            document.getElementById('tx-type').textContent = tx.transactionType?.toUpperCase() || '--';
            
             // Display masked emails
            document.getElementById('tx-sender-email').textContent = tx.senderEmail ? maskEmail(tx.senderEmail) : '--';
            document.getElementById('tx-receiver-email').textContent = tx.receiverEmail ? maskEmail(tx.receiverEmail) : '--';
            
            transactionResult.style.display = 'block';
        }

        function displayAddress(address, userData) {
            document.getElementById('address-header').textContent = address;
            document.getElementById('xyz-balance').textContent = `${userData.xyzBalance || 0} XYZ`;
            document.getElementById('sol-balance').textContent = `${userData.solBalance || 0} SOL`;
            addressResult.style.display = 'block';
        }

        async function displayAddressTransactions(address) {
            const container = document.getElementById('address-transactions');
            container.innerHTML = '';
            const txs = await db.collection("blockchain")
                                .where("from", "==", address)
                                .orderBy("timestamp", "desc")
                                .get();
            
            if (txs.empty) {
                container.innerHTML = '<p>No transactions found for this address.</p>';
                return;
            }
            
            txs.forEach(doc => {
                const tx = doc.data();
                addTransactionToContainer(doc, container);
            });
        }

        async function loadAllTransactions() {
            try {
                const querySnapshot = await db.collection("blockchain")
                                             .orderBy("timestamp", "desc")
                                             .get();
                
                allTransactions = querySnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                
                updateTransactionsDisplay();
                updatePagination();
            } catch (err) {
                console.error("Error loading transactions:", err);
                allTransactionsContainer.innerHTML = '<p>Error loading transactions. Please try again later.</p>';
            }
        }

        function updateTransactionsDisplay() {
            allTransactionsContainer.innerHTML = '';
            
            const startIndex = (currentPage - 1) * transactionsPerPage;
            const endIndex = startIndex + transactionsPerPage;
            const transactionsToShow = allTransactions.slice(startIndex, endIndex);
            
            if (transactionsToShow.length === 0) {
                allTransactionsContainer.innerHTML = '<p>No transactions found.</p>';
                return;
            }
            
            transactionsToShow.forEach(tx => {
                const div = document.createElement('div');
                div.className = 'transaction-item';
                
                const typeClass = tx.transactionType === 'sent' ? 'sent' : 'received';
                
                div.innerHTML = `
                    <div class="transaction-row">
                        <div class="transaction-data-item">
                            <span class="transaction-data-label">Status:</span>
                            <span class="transaction-data-value">${tx.status || '--'}</span>
                        </div>
                        <div class="transaction-data-item">
                            <span class="transaction-data-label">Time:</span>
                            <span class="transaction-data-value">${formatTimestamp(tx.timestamp)}</span>
                        </div>
                        <div class="transaction-data-item">
                            <span class="transaction-data-label">${tx.transactionType === 'sent' ? 'To:' : 'From:'}</span>
                            <span class="transaction-data-value">${tx.transactionType === 'sent' ? (tx.to || '--') : (tx.from || '--')}</span>
                        </div>
                        <div class="transaction-data-item">
                            <span class="transaction-data-label">Amount:</span>
                            <span class="transaction-data-value">${tx.amount || '--'} XYZ</span>
                        </div>
                        <div class="transaction-type ${typeClass}">${tx.transactionType?.toUpperCase() || '--'}</div>
                    </div>
                    <div class="transaction-hash-container">
                        <span class="transaction-hash-label">Hash:</span>
                        <span class="transaction-hash">${tx.id}</span>
                    </div>
                    ${tx.senderEmail || tx.receiverEmail ? `
                    <div class="transaction-data-item">
                                                ` : ''}
                `;
                
                div.addEventListener('click', async () => {
                    searchInput.value = tx.id;
                    await searchBlockchain(); // wait for transaction to load

                    const hashElement = document.querySelector('.transaction-hash');
                    if (hashElement) {
                        hashElement.scrollIntoView({ behavior: 'smooth' });
                    }
                });
                
                allTransactionsContainer.appendChild(div);
            });
        }

        function updatePagination() {
            paginationContainer.innerHTML = '';
            
            const totalPages = Math.ceil(allTransactions.length / transactionsPerPage);
            
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
                addPageButton(i);
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

        function addPageButton(pageNumber) {
            const pageBtn = document.createElement('button');
            pageBtn.className = `page-btn ${pageNumber === currentPage ? 'active' : ''}`;
            pageBtn.textContent = pageNumber;
            pageBtn.addEventListener('click', () => {
                currentPage = pageNumber;
                updateTransactionsDisplay();
                updatePagination();
                window.scrollTo({ top: allTransactionsContainer.offsetTop, behavior: 'smooth' });
            });
            paginationContainer.appendChild(pageBtn);
        }
        async function loadNetworkStats() {
            try {
                const snapshot = await db.collection("blockchain").get();
                document.getElementById('total-tx').textContent = snapshot.size;
                const addressSet = new Set();
                let totalXYZ = 0;
                snapshot.forEach(doc => {
                    const d = doc.data();
                    ['from', 'to', 'address'].forEach(key => d[key] && addressSet.add(d[key]));
                    totalXYZ += parseFloat(d.amount || 0);
                });
                document.getElementById('active-addresses').textContent = addressSet.size;
                document.getElementById('xyz-circulation').textContent = `${totalXYZ.toLocaleString()} XYZ`;
            } catch (err) {
                console.error(err);
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

        // Load initial data
        loadAllTransactions();
        loadNetworkStats();
    });
    
    // Notification logic
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
                showNextNotification(); // 🔁 loop
            }, 300); // match CSS transition
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

    // Crypto Ticker Logic
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

    // Adjust ticker animation duration based on content width for seamless loop
    function adjustTickerAnimation() {
        const ticker = document.getElementById('crypto-items');
        const tickerClone = document.getElementById('crypto-items-clone');
        if (ticker && tickerClone) {
            // Clone the content to create a seamless loop
            tickerClone.innerHTML = ticker.innerHTML;

            const totalWidth = ticker.scrollWidth;
            const wrapperWidth = ticker.parentElement.clientWidth;

            // If content is wider than wrapper, enable animation
            if (totalWidth > wrapperWidth) {
                const duration = totalWidth / 50; // Adjust 50 for speed
                ticker.style.animationDuration = `${duration}s`;
                tickerClone.style.animationDuration = `${duration}s`;
                ticker.style.animationPlayState = 'running';
                tickerClone.style.animationPlayState = 'running';
            } else {
                // If content is not wide enough, stop animation and center
                ticker.style.animationPlayState = 'paused';
                tickerClone.style.animationPlayState = 'paused';
                ticker.style.transform = 'translateX(0)';
                tickerClone.style.transform = 'translateX(0)';
                ticker.style.justifyContent = 'center'; /* Center items if not scrolling */
            }
        }
    }

    // Call on load and resize
    window.addEventListener('load', adjustTickerAnimation);
    window.addEventListener('resize', adjustTickerAnimation);

// Function to extract address or hash from URL
function extractAddressFromURL() {
    const url = window.location.href;
    
    // Check for hash pattern in URL (after the last slash)
    const lastSegment = url.substring(url.lastIndexOf('/') + 1);
    
    // Check if it's a hash (long alphanumeric string)
    if (lastSegment && lastSegment.length >= 32 && /^[a-zA-Z0-9]+$/.test(lastSegment)) {
        return lastSegment;
    }
    
    // Check for specific parameter patterns
    const addressMatch = url.match(/[?&](address|hash)=([^&]+)/);
    if (addressMatch && addressMatch[2]) {
        return addressMatch[2];
    }
    
    // Check for path-based pattern like your example
    const pathMatch = url.match(/\/address-block=([^&]+)/);
    if (pathMatch && pathMatch[1]) {
        return pathMatch[1];
    }
    
    return null;
}

// Function to automatically search if address/hash is detected in URL
function autoSearchFromURL() {
    const addressOrHash = extractAddressFromURL();
    
    if (addressOrHash) {
        // Set the search input value
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        
        if (searchInput && searchBtn) {
            searchInput.value = addressOrHash;
            
            // Scroll to search bar smoothly
            const searchSection = document.querySelector('.search-section');
            if (searchSection) {
                searchSection.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center'
                });
            }
            
            // Wait for DOM to be fully ready, then trigger search
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(() => {
                        searchBtn.click();
                    }, 1000);
                });
            } else {
                setTimeout(() => {
                    searchBtn.click();
                }, 1000);
            }
        }
    }
}

// Call the auto-search function when script loads
autoSearchFromURL();
