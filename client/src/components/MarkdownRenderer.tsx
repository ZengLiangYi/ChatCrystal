import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={className}>
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          if (!match) {
            return (
              <code className="cc-inline-code" {...props}>
                {children}
              </code>
            );
          }
          return (
            <div className="cc-code-block">
              <div className="cc-code-header">
                <span className="cc-code-lang">{match[1]}</span>
              </div>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={match[1]}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  borderRadius: '0 0 6px 6px',
                  background: 'var(--code-bg)',
                  fontSize: '13px',
                }}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            </div>
          );
        },
        table({ children, ...props }) {
          return (
            <div className="overflow-x-auto">
              <table className="cc-table" {...props}>
                {children}
              </table>
            </div>
          );
        },
        a({ children, ...props }) {
          return (
            <a target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </Markdown>
    </div>
  );
});
