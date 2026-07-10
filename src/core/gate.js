'use strict';

class ExecutionGate {
    constructor(capacity = 1) {
        this.capacity = capacity;
        this.active = 0;
        this.queue = [];
        this.closedError = null;
    }

    acquire(signal) {
        if (this.closedError) return Promise.reject(this.closedError);
        if (signal?.aborted) return Promise.reject(signal.reason);
        if (this.active < this.capacity) {
            this.active++;
            return Promise.resolve(this.createRelease());
        }

        return new Promise((resolve, reject) => {
            const entry = { resolve, reject, signal, onAbort: null };
            entry.onAbort = () => {
                const index = this.queue.indexOf(entry);
                if (index !== -1) this.queue.splice(index, 1);
                reject(signal.reason);
            };
            signal?.addEventListener('abort', entry.onAbort, { once: true });
            this.queue.push(entry);
        });
    }

    createRelease() {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active--;
            this.drain();
        };
    }

    drain() {
        while (!this.closedError && this.active < this.capacity && this.queue.length) {
            const entry = this.queue.shift();
            entry.signal?.removeEventListener('abort', entry.onAbort);
            if (entry.signal?.aborted) {
                entry.reject(entry.signal.reason);
                continue;
            }
            this.active++;
            entry.resolve(this.createRelease());
        }
    }

    close(error) {
        this.closedError = error;
        for (const entry of this.queue.splice(0)) {
            entry.signal?.removeEventListener('abort', entry.onAbort);
            entry.reject(error);
        }
    }
}

module.exports = { ExecutionGate };
