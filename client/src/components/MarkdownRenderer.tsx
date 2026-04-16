import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
              <pre className="cc-code-body">
                <code {...props}>{String(children).replace(/\n$/, '')}</code>
              </pre>
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
