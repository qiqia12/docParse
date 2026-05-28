import { useState } from 'react';

interface Props {
  images: Array<{ imageId: string; altText: string }>;
}

export default function ImageViewer({ images }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <div style={{ padding: '8px 24px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {images.map(img => (
          <img
            key={img.imageId}
            src={`/api/v1/images/${img.imageId}`}
            alt={img.altText}
            onClick={() => setSelected(img.imageId)}
            style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #eee' }}
          />
        ))}
      </div>
      {selected && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setSelected(null)}>
          <img src={`/api/v1/images/${selected}`} style={{ maxWidth: '90vw', maxHeight: '90vh' }} />
        </div>
      )}
    </>
  );
}
