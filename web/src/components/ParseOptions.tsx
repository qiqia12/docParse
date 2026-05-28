export default function ParseOptions() {
  return (
    <div style={{ maxWidth: 400, margin: '0 auto 24px', padding: 16, background: '#fff', borderRadius: 8, border: '1px solid #eee' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input type="checkbox" defaultChecked /> 提取图片
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input type="checkbox" defaultChecked /> 识别表格
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>页数限制:</span>
        <input type="number" defaultValue={0} min={0} style={{ width: 80, padding: '4px 8px' }} />
        <span style={{ color: '#888', fontSize: 12 }}>(0 = 无限制)</span>
      </label>
    </div>
  );
}
