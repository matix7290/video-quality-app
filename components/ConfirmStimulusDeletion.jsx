import AdminDialog from '@/components/AdminDialog';
import { translateAdmin } from '@/utils/admin-i18n.cjs';

export default function ConfirmStimulusDeletion({ file, locale, busy, error, onClose, onConfirm }) {
  const t = text => translateAdmin(locale, text);
  return <AdminDialog title={t('Usunąć bodziec?')} titleId="stimulus-deletion-title" closeLabel={t('Zamknij potwierdzenie')} locale={locale} onClose={onClose} busy={busy} className="admin-confirm-modal">
    <p className="admin-confirm-filename">{file.name}</p>
    <p className="admin-note">{t('Plik zostanie trwale usunięty z serwera, wyboru do badania i powiązanych pytań kontrolnych. Zebrane wyniki zostaną zachowane.')}</p>
    {error && <p className="admin-error" role="alert">{t(error)}</p>}
    <div className="admin-confirm-actions">
      <button type="button" className="admin-secondary" disabled={busy} onClick={onClose} autoFocus>{t('Anuluj')}</button>
      <button type="button" className="admin-danger" disabled={busy} onClick={onConfirm}>{t(busy ? 'Usuwanie…' : 'Usuń bodziec')}</button>
    </div>
  </AdminDialog>;
}
