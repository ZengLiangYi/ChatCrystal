export interface Locale {
  notesTitle: string;
  tagsTitle: string;
  conversationsTitle: string;
  searchTitle: string;
  relationsTitle: string;

  searchPlaceholder: string;
  searchConfirm: string;
  searchCancel: string;
  searchResult: (n: number) => string;
  searching: string;

  hints: {
    move: string;
    open: string;
    search: string;
    quit: string;
    back: string;
    scroll: string;
    prevNext: string;
    fullscreen: string;
    retry: string;
    summarize: string;
    delete: string;
  };

  deleteReviewTitle: string;
  deleteReviewReasonPrompt: string;
  deleteReviewConfirmPrompt: string;
  deleteReviewDeleting: string;
  deleteReviewError: string;
  deleteReviewHintsReason: string;
  deleteReviewHintsConfirm: string;
  deleteReviewReasonLabels: Record<
    'not-experience' | 'low-value' | 'inaccurate' | 'duplicate' | 'other',
    string
  >;

  pageInfo: (cur: number, total: number) => string;

  noNotes: string;
  noNotesHint: string;
  noResults: string;
  noTags: string;
  noConversations: string;
  noRelations: string;
  notSummarized: string;
  pressSToSummarize: string;

  summary: string;
  keyConclusions: string;
  codeSnippets: string;
  relatedNotes: string;
  tags: string;
  created: string;
  project: string;

  loadFailed: string;
  serverStarting: string;

  headerTitle: string;
  headerTags: string;
  headerCreated: string;
  headerScore: string;
  headerProject: string;
  headerSource: string;
  headerMsgs: string;
  headerStatus: string;
  headerLastActive: string;
  headerNotes: string;
  headerType: string;
  headerTarget: string;
  headerConfidence: string;
}

export const zh: Locale = {
  notesTitle: '笔记',
  tagsTitle: '标签',
  conversationsTitle: '对话',
  searchTitle: '搜索',
  relationsTitle: '关联笔记',

  searchPlaceholder: '输入搜索词...',
  searchConfirm: 'Enter 确认',
  searchCancel: 'Esc 取消',
  searchResult: (n: number) => `找到 ${n} 条结果`,
  searching: '搜索中...',

  hints: {
    move: '↑↓:移动',
    open: 'Enter:查看',
    search: '/:搜索',
    quit: 'q:退出',
    back: 'Esc:返回',
    scroll: '↑↓:滚动',
    prevNext: '←/→:上/下一条',
    fullscreen: 'Enter:全屏',
    retry: 'r:重试',
    summarize: 's:总结',
    delete: 'D:删除',
  },

  deleteReviewTitle: '删除笔记',
  deleteReviewReasonPrompt: '请选择删除原因',
  deleteReviewConfirmPrompt: '确认删除这条笔记并记录反馈？',
  deleteReviewDeleting: '删除中...',
  deleteReviewError: '删除失败',
  deleteReviewHintsReason: '↑↓ 移动  Enter 选择  Esc/q 取消',
  deleteReviewHintsConfirm: 'Enter 确认删除  Esc/q 取消',
  deleteReviewReasonLabels: {
    'not-experience': '不是经验',
    'low-value': '价值较低',
    inaccurate: '内容不准确',
    duplicate: '重复笔记',
    other: '其他',
  },

  pageInfo: (cur: number, total: number) => `${cur}/${total}`,

  noNotes: '还没有笔记',
  noNotesHint: '运行 crystal import 导入对话，然后 crystal summarize --all 生成',
  noResults: '未找到匹配结果，试试其他关键词',
  noTags: '还没有标签',
  noConversations: '还没有对话',
  noRelations: '没有关联笔记',
  notSummarized: '该对话尚未总结',
  pressSToSummarize: '按 s 立即总结',

  summary: '摘要',
  keyConclusions: '关键结论',
  codeSnippets: '代码片段',
  relatedNotes: '关联笔记',
  tags: '标签',
  created: '创建',
  project: '项目',

  loadFailed: '加载失败',
  serverStarting: '正在启动服务器...',

  headerTitle: '标题',
  headerTags: '标签',
  headerCreated: '创建时间',
  headerScore: '相关度',
  headerProject: '项目',
  headerSource: '来源',
  headerMsgs: '消息',
  headerStatus: '状态',
  headerLastActive: '最后活跃',
  headerNotes: '笔记数',
  headerType: '类型',
  headerTarget: '目标',
  headerConfidence: '置信度',
};
