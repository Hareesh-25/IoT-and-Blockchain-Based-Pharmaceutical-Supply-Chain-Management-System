const crypto = require('crypto');

class Block {
  constructor(index, previousHash, timestamp, transactions, nonce=0) {
    this.index = index;
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.nonce = nonce;
    this.hash = this.computeHash();
  }
  computeHash() {
    const data = this.index + this.previousHash + this.timestamp + JSON.stringify(this.transactions) + this.nonce;
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

class Blockchain {
  constructor() {
    this.chain = [this.createGenesis()];
    this.pendingTransactions = [];
    this.difficulty = 1;
  }
  createGenesis() { return new Block(0, "0", Date.now(), [{type:'genesis'}]); }
  getLatest() { return this.chain[this.chain.length-1]; }
  addTransaction(tx) { this.pendingTransactions.push(tx); }
  minePending() {
    const index = this.chain.length;
    const previousHash = this.getLatest().hash;
    const block = new Block(index, previousHash, Date.now(), this.pendingTransactions);
    while (!block.hash.startsWith(Array(this.difficulty+1).join("0"))) {
      block.nonce++; block.hash = block.computeHash();
    }
    this.chain.push(block); this.pendingTransactions = []; return block;
  }
  isChainValid() {
    for (let i=1;i<this.chain.length;i++){
      const curr=this.chain[i],prev=this.chain[i-1];
      if(curr.previousHash!==prev.hash||curr.hash!==curr.computeHash())return false;
    }return true;
  }
}
module.exports = Blockchain;
