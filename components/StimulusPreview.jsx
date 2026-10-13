import { useEffect, useRef } from 'react';
import { translateAdmin } from '@/utils/admin-i18n.cjs';

export default function StimulusPreview({ src, image, onClose, locale = 'pl' }) {
  const dialogRef = useRef(null);
  const t = text => translateAdmin(locale, text);

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

  const closeOnBackdrop = event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) {
      event.currentTarget.close();
    }
  };

  const handleClose = () => {
    // Strict Mode reopens the dialog before the cleanup's queued close event fires.
    // Only dismiss the preview when the current dialog is actually closed.
    if (dialogRef.current && !dialogRef.current.open) onClose();
  };

  return <dialog ref={dialogRef} className="admin-stimulus-modal" lang={locale} aria-labelledby="stimulus-preview-title" onClose={handleClose} onClick={closeOnBackdrop}>
    <header className="admin-stimulus-modal-header">
      <h2 id="stimulus-preview-title">{t('Podgląd bodźca')}</h2>
      <button type="button" className="admin-stimulus-modal-close" aria-label={t('Zamknij podgląd')} onClick={() => dialogRef.current.close()}>×</button>
    </header>
    {image ?
      // eslint-disable-next-line @next/next/no-img-element
      <img className="admin-image-preview" src={src} alt={t('Podgląd wybranego zdjęcia')} /> :
      <video className="admin-video-preview" src={src} controls preload="metadata" />}
  </dialog>;
}
