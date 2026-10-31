import { useMemo, useState } from "react";

/* Checkbox selection over the rows currently on screen. `ids` is the visible rows; a row that is
   filtered out or removed is never counted, so "Delete selected" only touches what you can see. */
export function useSelection(ids) {
  const [picked, setPicked] = useState(() => new Set());
  const selected = useMemo(() => ids.filter((id) => picked.has(id)), [ids, picked]);
  const allOn = ids.length > 0 && selected.length === ids.length;
  return {
    selected,
    allOn,
    has: (id) => picked.has(id),
    toggle: (id) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    setAll: (on) => setPicked((prev) => { const n = new Set(prev); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; }),
    clear: () => setPicked(new Set()),
  };
}
