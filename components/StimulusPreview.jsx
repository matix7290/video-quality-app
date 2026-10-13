import AdminDialog from '@/components/AdminDialog';
import { translateAdmin } from '@/utils/admin-i18n.cjs';

export default function StimulusPreview({ src, image, onClose, locale = 'pl' }) {
  const t = text => translateAdmin(locale, text);
  return <AdminDialog title={t('Podgląd bodźca')} titleId="stimulus-preview-title" closeLabel={t('Zamknij podgląd')} locale={locale} onClose={onClose}>
    {image ?
      // eslint-disable-next-line @next/next/no-img-element
      <img className="admin-image-preview" src={src} alt={t('Podgląd wybranego zdjęcia')} /> :
      <video className="admin-video-preview" src={src} controls preload="metadata" />}
  </AdminDialog>;
}
