import type { Locale } from './zh.js';

export const en: Locale = {
  notesTitle: 'Notes',
  tagsTitle: 'Tags',
  conversationsTitle: 'Conversations',
  searchTitle: 'Search',
  relationsTitle: 'Relations',

  searchPlaceholder: 'Type to search...',
  searchConfirm: 'Enter to confirm',
  searchCancel: 'Esc to cancel',
  searchResult: (n: number) => `Found ${n} results`,
  searching: 'Searching...',

  hints: {
    move: '↑↓:Move',
    open: 'Enter:Open',
    search: '/:Search',
    quit: 'q:Quit',
    back: 'Esc:Back',
    scroll: '↑↓:Scroll',
    prevNext: '←/→:Prev/Next',
    fullscreen: 'Enter:Fullscreen',
    retry: 'r:Retry',
    summarize: 's:Summarize',
  },

  pageInfo: (cur: number, total: number) => `${cur}/${total}`,

  noNotes: 'No notes yet',
  noNotesHint: 'Run crystal import then crystal summarize --all',
  noResults: 'No matches found, try different keywords',
  noTags: 'No tags yet',
  noConversations: 'No conversations yet',
  noRelations: 'No related notes',
  notSummarized: 'Not yet summarized',
  pressSToSummarize: 'Press s to summarize',

  summary: 'Summary',
  keyConclusions: 'Key Conclusions',
  codeSnippets: 'Code Snippets',
  relatedNotes: 'Related Notes',
  tags: 'Tags',
  created: 'Created',
  project: 'Project',

  loadFailed: 'Failed to load',
  serverStarting: 'Starting server...',

  headerTitle: 'Title',
  headerTags: 'Tags',
  headerCreated: 'Created',
  headerScore: 'Score',
  headerProject: 'Project',
  headerSource: 'Source',
  headerMsgs: 'Msgs',
  headerStatus: 'Status',
  headerLastActive: 'Last Active',
  headerNotes: 'Notes',
  headerType: 'Type',
  headerTarget: 'Target',
  headerConfidence: 'Confidence',
};
