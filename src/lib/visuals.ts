import { Repo } from '../types';

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Scala: '#c22d40',
  Dart: '#00B4AB',
  Elixir: '#6e4a7e',
  Haskell: '#5e5086',
  Lua: '#000080',
  Shell: '#89e051',
  Bash: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Zig: '#ec915c',
  Nix: '#7e7eff',
  OCaml: '#3be133',
  Clojure: '#db5855',
  'F#': '#b845fc',
  R: '#198CE7',
};

export function getLanguageColor(language: string | null | undefined): string {
  if (!language) return 'var(--color-faint)';
  return LANG_COLORS[language] ?? 'var(--color-faint)';
}

export type TopicIconName =
  | 'terminal'
  | 'globe'
  | 'smartphone'
  | 'package'
  | 'layers'
  | 'book'
  | 'sparkles'
  | 'database';

const TOPIC_ICON_MAP: Array<[RegExp, TopicIconName]> = [
  [/\b(cli|terminal|command.?line|shell)\b/, 'terminal'],
  [/\b(web|website|frontend|browser|http|api|rest|graphql)\b/, 'globe'],
  [/\b(mobile|ios|android|react.?native|flutter)\b/, 'smartphone'],
  [/\b(library|sdk|package|npm|crate|gem)\b/, 'package'],
  [/\b(framework|boilerplate|starter|scaffold)\b/, 'layers'],
  [/\b(tutorial|learning|course|book|docs|documentation|guide)\b/, 'book'],
  [/\b(ai|ml|llm|gpt|machine.?learning|deep.?learning|nlp)\b/, 'sparkles'],
  [/\b(database|db|sql|postgres|mysql|sqlite|redis|mongo)\b/, 'database'],
];

export function getTopicIcons(topics: string[], tags: string[]): TopicIconName[] {
  const haystack = [...topics, ...tags].join(' ').toLowerCase();
  const found: TopicIconName[] = [];
  for (const [re, icon] of TOPIC_ICON_MAP) {
    if (re.test(haystack)) {
      found.push(icon);
      if (found.length >= 2) break;
    }
  }
  return found;
}

export function isTallRow(repo: Repo, isFocused: boolean): boolean {
  if (isFocused) return true;
  if (repo.category_locked) return true;
  const tags: string[] = repo.llm_tags ? JSON.parse(repo.llm_tags) : [];
  return !!(repo.llm_use_case && tags.length >= 3);
}

export const TALL_HEIGHT = 124;
export const COMPACT_HEIGHT = 56;

export function getRowHeight(repo: Repo, isFocused: boolean): number {
  return isTallRow(repo, isFocused) ? TALL_HEIGHT : COMPACT_HEIGHT;
}

// Library view variants — user-selectable presentation of the repo list.
export type ViewVariant = 'dense' | 'comfy' | 'masonry';

export const DENSE_COMPACT_HEIGHT = 38;
export const DENSE_SELECTED_HEIGHT = 78;
export const COMFY_HEIGHT = 96;

export function getLibraryRowHeight(
  _repo: Repo,
  isFocused: boolean,
  variant: ViewVariant,
): number {
  switch (variant) {
    case 'dense':
      return isFocused ? DENSE_SELECTED_HEIGHT : DENSE_COMPACT_HEIGHT;
    case 'comfy':
      return COMFY_HEIGHT;
    case 'masonry':
      // Masonry renders without virtualization; this height is unused.
      return 0;
  }
}
