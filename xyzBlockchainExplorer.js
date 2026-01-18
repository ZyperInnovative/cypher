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

// ==================== BLOCKCHAIN CORE ====================

// SHA256 Implementation
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Blockchain Class
class Blockchain {
    constructor() {
        this.currentBlock = null;
        this.pendingTransactions = [];
        this.maxTransactionsPerBlock = 100;
        this.difficulty = 4;
    }

    async createBlock(transactions, previousHash = '0'.repeat(64)) {
        const timestamp = new Date().toISOString();
        const height = await this.getNextBlockHeight();
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

        block.blockHash = await this.mineBlock(block);
        return block;
    }

    async mineBlock(block) {
        let hash = '';
        let nonce = 0;
        const prefix = '0'.repeat(this.difficulty);

        while (true) {
            const blockData = JSON.stringify({ ...block, nonce });
            hash = await sha256(blockData);
            
            if (hash.startsWith(prefix)) {
                block.nonce = nonce;
                break;
            }
            
            nonce++;
            if (nonce % 10000 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        return hash;
    }

    async calculateMerkleRoot(transactions) {
        if (transactions.length === 0) return await sha256('empty');
        if (transactions.length === 1) return await sha256(JSON.stringify(transactions[0]));

        const hashPairs = [];
        for (let i = 0; i < transactions.length; i += 2) {
            const left = JSON.stringify(transactions[i]);
            const right = i + 1 < transactions.length ? JSON.stringify(transactions[i + 1]) : left;
            const pairHash = await sha256(left + right);
            hashPairs.push(pairHash);
        }

        return await this.calculateMerkleRoot(hashPairs);
    }

    async getNextBlockHeight() {
        try {
            const blocksSnapshot = await db.collection("blocks")
                .orderBy("height", "desc")
                .limit(1)
                .get();
            
            if (blocksSnapshot.empty) return 0;
            const lastBlock = blocksSnapshot.docs[0].data();
            return lastBlock.height + 1;
        } catch (error) {
            console.error("Error getting block height:", error);
            return 0;
        }
    }

    addTransaction(transaction) {
        this.pendingTransactions.push(transaction);
        if (this.pendingTransactions.length >= this.maxTransactionsPerBlock) {
            this.createBlockAndStore();
        }
    }

    async createBlockAndStore() {
        if (this.pendingTransactions.length === 0) return;

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

        const transactionsToMine = this.pendingTransactions.slice(0, this.maxTransactionsPerBlock);
        const newBlock = await this.createBlock(transactionsToMine, previousHash);

        try {
            await db.collection("blocks").doc(newBlock.blockHash).set({
                ...newBlock,
                storedAt: new Date().toISOString()
            });

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

            this.pendingTransactions = this.pendingTransactions.slice(this.maxTransactionsPerBlock);
            console.log(`Block ${newBlock.height} mined successfully!`);
            return newBlock;
        } catch (error) {
            console.error("Error storing block:", error);
            return null;
        }
    }
}

// Initialize Blockchain
const blockchain = new Blockchain();

// ==================== UTILITY FUNCTIONS ====================

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

function formatTimestamp(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return date.toLocaleString();
}

function generateTransactionLink(transactionId) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?tx=${transactionId}`;
}

function generateBlockLink(blockHash) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?block=${blockHash}`;
}

// ==================== UI FUNCTIONS ====================

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
        showToast('Copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showToast('Failed to copy', true);
    });
}

// Toast notification function
function showToast(message, isError = false) {
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification ${isError ? 'toast-error' : 'toast-success'}`;
    toast.textContent = message;
    
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
    
    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    
    setTimeout(() => {
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

function showError() {
    const errorMessage = document.getElementById('error-message');
    if (errorMessage) errorMessage.style.display = 'block';
}

// ==================== TRANSACTION FUNCTIONS ====================

let allTransactions = [];
let currentPage = 1;
const transactionsPerPage = 20;

async function loadAllTransactions() {
    try {
        const allTransactionsContainer = document.getElementById('all-transactions');
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
        const allTransactionsContainer = document.getElementById('all-transactions');
        if (allTransactionsContainer) {
            allTransactionsContainer.innerHTML = '<p>Error loading transactions. Please try again later.</p>';
        }
    }
}

function updateTransactionsDisplay() {
    const allTransactionsContainer = document.getElementById('all-transactions');
    if (!allTransactionsContainer) return;

    allTransactionsContainer.innerHTML = '';
    
    const startIndex = (currentPage - 1) * transactionsPerPage;
    const endIndex = startIndex + transactionsPerPage;
    const transactionsToShow = allTransactions.slice(startIndex, endIndex);
    
    if (transactionsToShow.length === 0) {
        allTransactionsContainer.innerHTML = '<p>No transactions found.</p>';
        return;
    }
    
    transactionsToShow.forEach(tx => {
        const transactionElement = createTransactionElement(tx, false);
        allTransactionsContainer.appendChild(transactionElement);
    });
}

function updatePagination() {
    const paginationContainer = document.getElementById('pagination');
    if (!paginationContainer) return;

    paginationContainer.innerHTML = '';
    const totalPages = Math.ceil(allTransactions.length / transactionsPerPage);
    
    // Previous button
    if (currentPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.textContent = 'Previous';
        prevBtn.addEventListener('click', () => {
            currentPage--;
            updateTransactionsDisplay();
            updatePagination();
            const allTransactionsContainer = document.getElementById('all-transactions');
            if (allTransactionsContainer) {
                window.scrollTo({ top: allTransactionsContainer.offsetTop, behavior: 'smooth' });
            }
        });
        paginationContainer.appendChild(prevBtn);
    }

    // Page numbers
    let startPage = Math.max(1, currentPage - 1);
    let endPage = Math.min(totalPages, currentPage + 1);

    if (currentPage === 1) {
        endPage = Math.min(totalPages, 3);
    } else if (currentPage === totalPages) {
        startPage = Math.max(1, totalPages - 2);
    }

    for (let i = startPage; i <= endPage; i++) {
        addPageButton(i, paginationContainer);
    }
    
    // Next button
    if (currentPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn';
        nextBtn.textContent = 'Next';
        nextBtn.addEventListener('click', () => {
            currentPage++;
            updateTransactionsDisplay();
            updatePagination();
            const allTransactionsContainer = document.getElementById('all-transactions');
            if (allTransactionsContainer) {
                window.scrollTo({ top: allTransactionsContainer.offsetTop, behavior: 'smooth' });
            }
        });
        paginationContainer.appendChild(nextBtn);
    }
}

function addPageButton(pageNumber, paginationContainer) {
    const pageBtn = document.createElement('button');
    pageBtn.className = `page-btn ${pageNumber === currentPage ? 'active' : ''}`;
    pageBtn.textContent = pageNumber;
    pageBtn.addEventListener('click', () => {
        currentPage = pageNumber;
        updateTransactionsDisplay();
        updatePagination();
        const allTransactionsContainer = document.getElementById('all-transactions');
        if (allTransactionsContainer) {
            window.scrollTo({ top: allTransactionsContainer.offsetTop, behavior: 'smooth' });
        }
    });
    paginationContainer.appendChild(pageBtn);
}

// ==================== BLOCK FUNCTIONS ====================

async function loadBlocks(page = 1, itemsPerPage = 10) {
    try {
        const blocksList = document.getElementById('blocks-list');
        if (!blocksList) return;

        const totalSnapshot = await db.collection("blocks").count().get();
        const totalBlocks = totalSnapshot.data().count;
        
        const totalBlocksEl = document.getElementById('total-blocks');
        const blockHeightEl = document.getElementById('block-height');
        if (totalBlocksEl) totalBlocksEl.textContent = totalBlocks;
        if (blockHeightEl) blockHeightEl.textContent = totalBlocks > 0 ? totalBlocks - 1 : '0';

        const query = db.collection("blocks").orderBy("height", "desc");
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

        updateBlockPagination(totalBlocks, page, itemsPerPage);
    } catch (error) {
        console.error("Error loading blocks:", error);
    }
}

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

async function displayBlockDetails(block) {
    const blockResult = document.getElementById('block-result');
    if (!blockResult) return;

    document.getElementById('address-result').style.display = 'none';
    document.getElementById('transaction-result').style.display = 'none';
    
    document.getElementById('block-hash-header').textContent = block.blockHash;
    document.getElementById('block-height-detail').textContent = block.height;
    document.getElementById('block-hash-detail').textContent = block.blockHash;
    document.getElementById('prev-hash-detail').textContent = block.previousHash;
    document.getElementById('block-timestamp').textContent = formatTimestamp(block.timestamp);
    document.getElementById('block-transaction-count').textContent = block.transactions ? block.transactions.length : 0;
    document.getElementById('merkle-root').textContent = block.merkleRoot;
    document.getElementById('block-nonce').textContent = block.nonce;
    document.getElementById('block-difficulty-detail').textContent = block.difficulty;
    
    const transactionsContainer = document.getElementById('block-transactions');
    transactionsContainer.innerHTML = '';
    
    if (block.transactions && block.transactions.length > 0) {
        const transactionPromises = block.transactions.map(async tx => {
            if (typeof tx === 'string') {
                const txDoc = await db.collection("blockchain").doc(tx).get();
                return txDoc.exists ? { id: txDoc.id, ...txDoc.data() } : null;
            }
            return tx;
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

function createTransactionElement(tx, showBlockLink = false) {
    const div = document.createElement('div');
    div.className = 'transaction-item';
    
    const typeClass = tx.transactionType === 'sent' ? 'sent' : 'received';
    const transactionLink = generateTransactionLink(tx.id);
    
    div.innerHTML = `
        <div class="transaction-row">
            <div class="transaction-data-item">
                <span class="transaction-data-label">Status:</span>
                <span class="transaction-data-value">${tx.status || (tx.blockHash ? 'Confirmed' : 'Pending')}</span>
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
        if (e.target.tagName === 'BUTTON' || e.target.classList.contains('transaction-link') || e.target.classList.contains('block-link')) {
            return;
        }
        
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = tx.id;
            await searchBlockchain();
        }
        
        const hashElement = document.querySelector('.transaction-hash');
        if (hashElement) {
            hashElement.scrollIntoView({ behavior: 'smooth' });
        }
    });
    
    return div;
}

function updateBlockPagination(totalBlocks, currentPage, itemsPerPage) {
    const paginationContainer = document.getElementById('block-pagination');
    if (!paginationContainer) return;

    const totalPages = Math.ceil(totalBlocks / itemsPerPage);
    paginationContainer.innerHTML = '';

    if (currentPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.textContent = 'Previous';
        prevBtn.addEventListener('click', () => {
            loadBlocks(currentPage - 1, itemsPerPage);
        });
        paginationContainer.appendChild(prevBtn);
    }

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

// ==================== SEARCH FUNCTION ====================

async function searchBlockchain() {
    const searchInput = document.getElementById('search-input');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const addressResult = document.getElementById('address-result');
    const transactionResult = document.getElementById('transaction-result');
    const blockResult = document.getElementById('block-result');
    
    if (!searchInput || !loading) return;
    
    const query = searchInput.value.trim();
    if (!query) return;

    loading.style.display = 'flex';
    if (errorMessage) errorMessage.style.display = 'none';
    if (addressResult) addressResult.style.display = 'none';
    if (transactionResult) transactionResult.style.display = 'none';
    if (blockResult) blockResult.style.display = 'none';

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
        if (listContainer) {
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
        }

    } catch (error) {
        console.error("Search error:", error);
        showError();
    } finally {
        loading.style.display = 'none';
    }
}

function displayTransaction(txDocSnap) {
    const tx = txDocSnap.data();
    const transactionResult = document.getElementById('transaction-result');
    if (!transactionResult) return;

    document.getElementById('address-result').style.display = 'none';
    document.getElementById('block-result').style.display = 'none';
    
    document.getElementById('tx-hash-header').textContent = txDocSnap.id;
    document.getElementById('tx-status').textContent = tx.status || (tx.blockHash ? 'Confirmed' : 'Pending');
    document.getElementById('tx-timestamp').textContent = formatTimestamp(tx.timestamp);
    document.getElementById('tx-from').textContent = tx.from || '--';
    document.getElementById('tx-to').textContent = tx.to || '--';
    document.getElementById('tx-amount').textContent = tx.amount ? `${tx.amount} XYZ` : '--';
    document.getElementById('tx-gas').textContent = tx.gasFee ? `${tx.gasFee} SOL` : '--';
    document.getElementById('tx-type').textContent = tx.transactionType?.toUpperCase() || '--';
    
    document.getElementById('tx-sender-email').textContent = tx.senderEmail ? maskEmail(tx.senderEmail) : '--';
    document.getElementById('tx-receiver-email').textContent = tx.receiverEmail ? maskEmail(tx.receiverEmail) : '--';
    
    // Add block information if available
    const dataGrid = document.querySelector('#transaction-result .data-grid');
    if (dataGrid && tx.blockHash) {
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
    if (dataGrid) {
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
    }
    
    transactionResult.style.display = 'block';
}

// ==================== NETWORK STATS ====================

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

// ==================== MINING PROCESS ====================

async function startMiningProcess() {
    setInterval(async () => {
        try {
            const unconfirmedSnapshot = await db.collection("blockchain")
                .where("blockHash", "==", null)
                .limit(100)
                .get();
            
            if (!unconfirmedSnapshot.empty) {
                const unconfirmedTransactions = unconfirmedSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                
                unconfirmedTransactions.forEach(tx => {
                    blockchain.addTransaction(tx);
                });
                
                if (blockchain.pendingTransactions.length >= blockchain.maxTransactionsPerBlock) {
                    await blockchain.createBlockAndStore();
                }
            }
        } catch (error) {
            console.error("Error in mining process:", error);
        }
    }, 30000);
}

// ==================== URL HANDLING ====================

function handleURLParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const txHash = urlParams.get('tx');
    const blockHash = urlParams.get('block');
    
    if (txHash) {
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        
        if (searchInput && searchBtn) {
            searchInput.value = txHash;
            setTimeout(() => {
                searchBtn.click();
            }, 500);
        }
    } else if (blockHash) {
        loadBlockByHash(blockHash);
    }
}

async function loadBlockByHash(blockHash) {
    try {
        const blockDoc = await db.collection("blocks").doc(blockHash).get();
        
        if (blockDoc.exists) {
            displayBlockDetails(blockDoc.data());
        } else {
            const blocksSnapshot = await db.collection("blocks")
                .where("blockHash", ">=", blockHash)
                .where("blockHash", "<=", blockHash + '\uf8ff')
                .limit(1)
                .get();
            
            if (!blocksSnapshot.empty) {
                displayBlockDetails(blocksSnapshot.docs[0].data());
            }
        }
    } catch (error) {
        console.error("Error loading block:", error);
    }
}

// ==================== NOTIFICATIONS ====================

const walletNotificationContainer = document.getElementById('walletNotification');
const showTime = 5000;
let notificationQueue = [];
let currentIndex = 0;
let isShowing = false;

function showNextNotification() {
    if (notificationQueue.length === 0 || !walletNotificationContainer) {
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

// ==================== CRYPTO TICKER ====================

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
            if (!ticker || !tickerClone) return;
            
            ticker.innerHTML = '';  
            tickerClone.innerHTML = '';
            
            const fragment = document.createDocumentFragment();
            
            for (const [id, crypto] of Object.entries(cryptos)) {  
                if (!data[id]) continue;
                
                const price = data[id].usd;  
                const change24h = data[id].usd_24h_change || 0;
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
            ticker.appendChild(fragment.cloneNode(true));
            tickerClone.appendChild(fragment.cloneNode(true));
        })  
        .catch(error => console.error('Error fetching prices:', error));  
}

function adjustTickerAnimation() {
    const ticker = document.getElementById('crypto-items');
    const tickerClone = document.getElementById('crypto-items-clone');
    if (ticker && tickerClone) {
        tickerClone.innerHTML = ticker.innerHTML;

        const totalWidth = ticker.scrollWidth;
        const wrapperWidth = ticker.parentElement.clientWidth;

        if (totalWidth > wrapperWidth) {
            const duration = totalWidth / 50;
            ticker.style.animationDuration = `${duration}s`;
            tickerClone.style.animationDuration = `${duration}s`;
            ticker.style.animationPlayState = 'running';
            tickerClone.style.animationPlayState = 'running';
        } else {
            ticker.style.animationPlayState = 'paused';
            tickerClone.style.animationPlayState = 'paused';
            ticker.style.transform = 'translateX(0)';
            tickerClone.style.transform = 'translateX(0)';
            ticker.style.justifyContent = 'center';
        }
    }
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    // Setup search
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    
    if (searchInput && searchBtn) {
        searchBtn.addEventListener('click', searchBlockchain);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchBlockchain();
        });
    }

    // Load initial data
    loadAllTransactions();
    loadNetworkStats();
    loadBlocks();
    fetchPrices();
    
    // Start background processes
    startMiningProcess();
    setupNotificationListener();
    
    // Handle URL parameters
    handleURLParameters();
    
    // Setup ticker animation
    window.addEventListener('load', adjustTickerAnimation);
    window.addEventListener('resize', adjustTickerAnimation);
    setInterval(fetchPrices, 120000);
});

// ==================== DATA ORGANIZATION (Run once) ====================

async function organizeExistingData() {
    try {
        console.log("Organizing existing blockchain data...");
        
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
        
        const transactionGroups = [];
        for (let i = 0; i < transactions.length; i += 100) {
            transactionGroups.push(transactions.slice(i, i + 100));
        }
        
        console.log(`Creating ${transactionGroups.length} blocks...`);
        
        for (let i = 0; i < transactionGroups.length; i++) {
            const group = transactionGroups[i];
            
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
            
            const newBlock = await blockchain.createBlock(group, previousHash);
            newBlock.height = i;
            
            await db.collection("blocks").doc(newBlock.blockHash).set({
                ...newBlock,
                storedAt: new Date().toISOString()
            });
            
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
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log("Data organization complete!");
        loadBlocks();
        
    } catch (error) {
        console.error("Error organizing data:", error);
    }
}

// Uncomment to run organization once
// organizeExistingData();
