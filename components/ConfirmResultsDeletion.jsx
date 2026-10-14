import AdminDialog from '@/components/AdminDialog';
import { translateAdmin } from '@/utils/admin-i18n.cjs';

export default function ConfirmResultsDeletion({ step, locale, busy, error, onClose, onNext, onConfirm }) {
  const t = text => translateAdmin(locale, text);
  return <AdminDialog title={t(step === 1 ? 'Usunąć wszystkie wyniki?' : 'Ostateczne potwierdzenie usunięcia')} titleId="results-deletion-title" closeLabel={t('Zamknij potwierdzenie')} locale={locale} onClose={onClose} busy={busy} className="admin-confirm-modal">
    {step === 1 ? <p className="admin-note">{t('Zostaną trwale usunięte wszystkie sesje uczestników, oceny, odpowiedzi na pytania kontrolne i testy ekranu. Trwające badania zostaną przerwane. Ustawienia badania i bodźce zostaną zachowane.')}</p>
      : <p className="admin-note">{t('Tej operacji nie można cofnąć. Czy na pewno usunąć wszystkie wyniki?')}</p>}
    {error && <p className="admin-error" role="alert">{t(error)}</p>}
    <div className="admin-confirm-actions">
      <button type="button" className="admin-secondary" disabled={busy} onClick={onClose} autoFocus>{t('Anuluj')}</button>
      <button type="button" className="admin-danger" disabled={busy} onClick={step === 1 ? onNext : onConfirm}>{t(step === 1 ? 'Tak' : busy ? 'Usuwanie…' : 'Usuń wszystkie wyniki')}</button>
    </div>
  </AdminDialog>;
}
