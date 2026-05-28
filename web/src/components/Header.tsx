export default function Header() {
  return (
    <header style={{ padding: '16px 24px', borderBottom: '1px solid #e0e0e0', background: '#fff' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700 }}>DocParse</h1>
      <span style={{ color: '#666', fontSize: '14px' }}>文档结构化解析 — 支持 TXT / DOCX / PDF / PPTX</span>
    </header>
  );
}
