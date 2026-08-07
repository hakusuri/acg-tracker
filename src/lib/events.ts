type Listener = () => void;
let addListeners: Listener[] = [];

export function requestAddWork(): void {
  for (const l of addListeners) l();
}

export function onRequestAddWork(cb: Listener): () => void {
  addListeners.push(cb);
  return () => {
    addListeners = addListeners.filter((l) => l !== cb);
  };
}