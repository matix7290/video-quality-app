import { useRef, useState } from 'react';
import { droppedFiles } from '@/utils/dropped-files.cjs';

export default function StimulusDropZone({ imageStudy, busy, onFiles, onError, t }) {
  const input = useRef(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const disabled = busy || reading;
  const isFileDrag = event => Array.from(event.dataTransfer.types).includes('Files');
  const resetDrag = () => { dragDepth.current = 0; setDragging(false); };
  const drop = async event => {
    event.preventDefault();
    resetDrag();
    if (disabled || !isFileDrag(event)) return;
    setReading(true);
    try { await onFiles(await droppedFiles(event.dataTransfer)); }
    catch { onError('Nie udało się odczytać upuszczonych plików. Spróbuj ponownie lub użyj przycisku Dodaj folder.'); }
    finally { setReading(false); }
  };
  return <>
    <button type="button" className={`admin-drop-zone${dragging ? ' is-dragging' : ''}`} disabled={disabled}
      onClick={() => input.current?.click()}
      onDragEnter={event => { if (isFileDrag(event)) { event.preventDefault(); if (!disabled) { dragDepth.current += 1; setDragging(true); } } }}
      onDragOver={event => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; } }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={drop}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
      <strong>{disabled ? t('Przetwarzanie…') : dragging ? t('Upuść pliki, aby je dodać') : imageStudy ? t('Przeciągnij tutaj zdjęcia lub folder ze zdjęciami') : t('Przeciągnij tutaj filmy lub folder z filmami')}</strong>
      <span>{t('lub kliknij, aby wybrać pliki')}</span>
      <small>{imageStudy ? t('JPG, PNG, WebP · do 50 MB na plik') : t('MP4 · do 2 GB na plik')}</small>
    </button>
    <input ref={input} type="file" hidden disabled={disabled} multiple
      accept={imageStudy ? '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' : 'video/mp4,.mp4'}
      onChange={event => { const files = Array.from(event.target.files); event.target.value = ''; if (files.length) onFiles(files); }} />
  </>;
}
