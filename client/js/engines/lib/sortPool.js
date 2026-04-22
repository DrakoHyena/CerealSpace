class SortWorkerPool {
  constructor() {
    this.workerAmount = 2;
    this.workers = [];
    this.queue = [];

    for (let i = 0; i < this.workerAmount; i++) {
      this.spawnSortWorker();
    }
  }
  requestSort(entityBuf, idBuf) {
    const promise = new Promise((res, rej) => {
      this.queue.push([entityBuf, idBuf, res]);
    });
    this.processQueue();
    return promise;
  }
  processQueue() {
    if (this.queue.length === 0) return;
    for (let workerObj of this.workers) {
      if (workerObj.busy) continue;
      workerObj.worker.postMessage({});
    }
  }
  spawnSortWorker() {
    const obj = {
      busy: false,
      worker: worker,
    };
    worker.onmessage = (e) => {
      this.workers.push(worker);
    };
  }
}

export { SortWorkerPool };
