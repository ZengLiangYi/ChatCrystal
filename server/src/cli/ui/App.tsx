import React, { useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import { useViewStack, type ViewState } from './hooks/useViewStack.js';
import { useTerminalSize, MIN_WIDTH, MIN_HEIGHT } from './hooks/useTerminalSize.js';
import { NotesListView } from './views/NotesListView.js';
import { NoteDetailView } from './views/NoteDetailView.js';
import { SearchView } from './views/SearchView.js';
import { TagsView } from './views/TagsView.js';
import { ConversationsView, type ConversationItem } from './views/ConversationsView.js';
import { RelationsView } from './views/RelationsView.js';
import type { CrystalClient } from '../client.js';

interface AppProps {
  client: CrystalClient;
  initialView: ViewState;
}

/**
 * Root interactive app. Manages view stack and routes to view components.
 * Each command creates an <App> with the appropriate initial view.
 */
export function App({ client, initialView }: AppProps) {
  const { current, depth, push, pop } = useViewStack(initialView);
  const { columns, rows } = useTerminalSize();
  const { exit } = useApp();

  // Unique key per view instance to force full remount (fixes useInput re-registration)
  const viewKey = `${current.type}-${depth}-${JSON.stringify(current.props)}`;

  const quit = useCallback(() => {
    exit();
  }, [exit]);

  const goBack = useCallback(() => {
    pop();
  }, [pop]);

  // Terminal too small
  if (columns < MIN_WIDTH || rows < MIN_HEIGHT) {
    return (
      <Box paddingLeft={1}>
        <Text color="yellow">Terminal too small ({columns}x{rows}). Need at least {MIN_WIDTH}x{MIN_HEIGHT}.</Text>
      </Box>
    );
  }

  const viewType = current.type;
  const props = current.props;

  switch (viewType) {
    case 'notes-list':
      return (
        <NotesListView
          key={viewKey}
          client={client}
          tagFilter={props.tagFilter as string | undefined}
          onSelectNote={(noteId, index) => {
            push({ type: 'note-detail', props: { noteId, currentIndex: index } });
          }}
          onSearch={() => push({ type: 'search', props: {} })}
          onQuit={quit}
        />
      );

    case 'note-detail':
      return (
        <NoteDetailView
          key={viewKey}
          client={client}
          noteId={props.noteId as number}
          noteIds={props.noteIds as number[] | undefined}
          currentIndex={props.currentIndex as number | undefined}
          total={props.total as number | undefined}
          onBack={goBack}
          onNavigate={(noteId, index) => {
            push({ type: 'note-detail', props: { ...props, noteId, currentIndex: index } });
          }}
        />
      );

    case 'search':
      return (
        <SearchView
          key={viewKey}
          client={client}
          initialQuery={props.initialQuery as string | undefined}
          onSelectNote={(noteId, index) => {
            push({ type: 'note-detail', props: { noteId, currentIndex: index } });
          }}
          onBack={goBack}
        />
      );

    case 'tags':
      return (
        <TagsView
          key={viewKey}
          client={client}
          onSelectTag={(tagName) => {
            push({ type: 'notes-list', props: { tagFilter: tagName } });
          }}
          onQuit={quit}
        />
      );

    case 'conversations':
      return (
        <ConversationsView
          key={viewKey}
          client={client}
          source={props.source as string | undefined}
          status={props.status as string | undefined}
          search={props.search as string | undefined}
          onSelect={(conv: ConversationItem) => {
            if (conv.status === 'summarized') {
              push({ type: 'search', props: { initialQuery: conv.project_name || conv.id } });
            }
          }}
          onSearch={() => push({ type: 'search', props: {} })}
          onQuit={quit}
        />
      );

    case 'relations':
      return (
        <RelationsView
          key={viewKey}
          client={client}
          noteId={props.noteId as number}
          onSelectNote={(noteId, index) => {
            push({ type: 'note-detail', props: { noteId, currentIndex: index } });
          }}
          onBack={goBack}
        />
      );

    default:
      return <Text color="red">Unknown view: {viewType}</Text>;
  }
}
