import { useEffect, useRef } from 'react';

export default function AdminDialog({ title, titleId, closeLabel, locale, onClose, busy = false, className = '', children }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const handleClose = () => {
    // Ignore the queued cleanup event after Strict Mode has reopened the dialog.
    if (dialogRef.current && !dialogRef.current.open) onClose();
  };
  const closeOnBackdrop = event => {
    if (busy || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      event.currentTarget.close();
    }
  };
  return <dialog ref={dialogRef} className={`admin-stimulus-modal ${className}`} lang={locale} aria-labelledby={titleId} onClose={handleClose} onClick={closeOnBackdrop} onCancel={event => { if (busy) event.preventDefault(); }}>
    <header className="admin-stimulus-modal-header">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="admin-stimulus-modal-close" disabled={busy} aria-label={closeLabel} onClick={() => dialogRef.current.close()}>×</button>
    </header>
    {children}
  </dialog>;
}
