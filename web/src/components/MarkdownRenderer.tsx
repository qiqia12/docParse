import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface Props {
  content: string;
}

export default function MarkdownRenderer({ content }: Props) {
  if (!content) {
    return <p style={{ color: '#999', textAlign: 'center', padding: 48 }}>等待解析结果...</p>;
  }

  return (
    <div className="markdown-body" style={{ padding: 24 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
