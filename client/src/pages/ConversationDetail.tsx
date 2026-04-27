import { memo, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Bot, Wrench, ChevronRight, ChevronDown, Sparkles, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConversation } from '@/hooks/use-conversations.ts';
import { useSummarize } from '@/hooks/use-notes.ts';
import { useQueueTasks } from '@/hooks/use-queue.ts';
import { MarkdownRenderer } from '@/components/MarkdownRenderer.tsx';

export function ConversationDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useConversation(id!);
  const summarize = useSummarize();
  const { data: queueData } = useQueueTasks();

  const messages = useMemo(() => (data?.messages ?? []) as MessageData[], [data?.messages]);

  // Group consecutive tool-use-only messages (must be before early returns)
  const groupedMessages = useMemo(() => {
    const groups: (MessageData | MessageData[])[] = [];
    let toolBatch: MessageData[] = [];

    const flushBatch = () => {
      if (toolBatch.length > 0) {
        groups.push(toolBatch);
        toolBatch = [];
      }
    };

    for (const msg of messages) {
      if (msg.has_tool_use === 1 && !msg.content.trim()) {
        toolBatch.push(msg);
      } else {
        flushBatch();
        groups.push(msg);
      }
    }
    flushBatch();
    return groups;
  }, [messages]);

  if (isLoading) {
    return <div className="p-6 text-muted">{t('status.loading')}</div>;
  }

  if (!data) {
    return <div className="p-6 text-error">{t('error.conversation_not_found')}</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-theme bg-secondary shrink-0">
        <button
          type="button"
          onClick={() => navigate('/conversations')}
          className="text-muted hover:text-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold truncate">
            {data.project_name as string}
          </h2>
          <p className="text-xs text-muted font-mono">
            {data.slug as string || (data.id as string).slice(0, 12)}
            <span className="ml-2">· {t('conversation.messages_count', { count: messages.length })}</span>
          </p>
        </div>
        <SummarizeButton
          status={data.status as string}
          queueTask={queueData?.tasks.find((task) => task.id === id)}
          onSummarize={() => summarize.mutate(id!)}
          isPending={summarize.isPending}
          navigate={navigate}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {groupedMessages.map((item) => {
          if (Array.isArray(item)) {
            return <ToolCallGroup key={item[0].id} messages={item} />;
          }
          return <MessageBubble key={item.id} message={item} />;
        })}
      </div>
    </div>
  );
}

interface MessageData {
  id: string;
  type: string;
  role: string;
  content: string;
  has_tool_use: number;
  has_code: number;
  thinking: string | null;
  timestamp: string;
}

function ToolCallGroup({ messages }: { messages: MessageData[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const count = messages.length;

  return (
    <div className="px-10">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-1 text-xs text-muted hover:text-secondary transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} />
        <span>{t('conversation.tool_calls_count', { count })}</span>
      </button>
      {expanded && (
        <div className="ml-5 pl-3 border-l border-theme space-y-0.5 mt-1 mb-1">
          {messages.map((msg) => (
            <div key={msg.id} className="text-xs text-muted py-0.5 font-mono truncate">
              {msg.timestamp
                ? new Date(msg.timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: MessageData;
}) {
  const { t } = useTranslation();
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <span className="text-xs text-muted bg-tertiary px-3 py-1 rounded-full">
          {message.content.slice(0, 100)}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs"
        style={{
          background: isUser ? 'var(--info)' : 'var(--accent)',
          color: 'var(--bg-primary)',
        }}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Content */}
      <div
        className={`max-w-[75%] px-3 py-2 text-sm leading-relaxed ${
          isUser ? 'bg-tertiary' : 'bg-secondary'
        } border border-theme`}
        style={{ borderRadius: 'var(--radius)' }}
      >
        {/* Tool use indicator (icon only) */}
        {message.has_tool_use === 1 && (
          <div className="flex items-center gap-1 mb-1" title={t('conversation.tool_use_indicator')}>
            <Wrench size={11} style={{ color: 'var(--text-muted)' }} />
          </div>
        )}

        {/* Message content with Markdown rendering */}
        <MarkdownRenderer content={message.content} className="markdown-content" />

        {/* Timestamp */}
        <div className="text-xs text-muted mt-1 text-right">
          {new Date(message.timestamp).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
});

// Summarize button with state machine
function SummarizeButton({
  status, queueTask, onSummarize, isPending, navigate,
}: {
  status: string;
  queueTask?: { status: string };
  onSummarize: () => void;
  isPending: boolean;
  navigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  // Determine visual state — queue status takes priority over DB status
  const queueStatus = queueTask?.status;
  const isQueued = queueStatus === 'queued';
  const isProcessing = queueStatus === 'processing' || isPending;
  const isDone = status === 'summarized';
  const isError = status === 'error';

  if (isQueued) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-tertiary border border-theme opacity-60 shrink-0 animate-pulse"
        style={{ borderRadius: 'var(--radius)', color: 'var(--text-muted)' }}
      >
        <Loader2 size={12} />
        {t('status.queued_ellipsis')}
      </button>
    );
  }

  if (isProcessing) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-tertiary border shrink-0"
        style={{ borderRadius: 'var(--radius)', color: 'var(--accent)', borderColor: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}
      >
        <Loader2 size={12} className="animate-spin" />
        {t('status.generating')}
      </button>
    );
  }

  if (isDone) {
    return (
      <button
        type="button"
        onClick={() => navigate('/notes')}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-tertiary border border-theme hover:border-[var(--success)] transition-colors shrink-0"
        style={{ borderRadius: 'var(--radius)', color: 'var(--success)' }}
      >
        <FileText size={12} />
        {t('action.view_notes')}
      </button>
    );
  }

  if (isError) {
    return (
      <button
        type="button"
        onClick={onSummarize}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-tertiary border hover:border-[var(--error)] transition-colors shrink-0"
        style={{ borderRadius: 'var(--radius)', color: 'var(--error)', borderColor: 'var(--error)' }}
      >
        <AlertTriangle size={12} />
        {t('status.failed_retry')}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSummarize}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-tertiary border border-theme hover:border-[var(--accent)] transition-colors shrink-0"
      style={{ borderRadius: 'var(--radius)', color: 'var(--accent)' }}
    >
      <Sparkles size={12} />
      {t('action.generate_summary')}
    </button>
  );
}
