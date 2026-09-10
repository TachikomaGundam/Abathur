// Type declarations for grader-support.mjs (NodeNext consumers, todo-5
// stub-mutators.mjs/.d.mts pattern). The .mjs file is the runtime; this is the
// compile-time contract the offline unit tests are written against.

export interface WikiRow {
  readonly id: number;
  readonly path: string;
  readonly locale: string;
  readonly updatedAt: string;
  readonly title?: string | undefined;
  readonly isPublished?: boolean | undefined;
  readonly isPrivate?: boolean | undefined;
}

export interface TouchedPage {
  readonly path: string;
  readonly locale: string;
  readonly title: string;
  readonly content: string;
}

export interface MovedPage {
  readonly from: string;
  readonly to: string;
}

export interface TranscriptMeta {
  readonly finalMessage: string;
  readonly tokensEst: number;
  readonly turns: number;
  readonly eventCount: number;
}

export interface WikiDiff {
  readonly created: TouchedPage[];
  readonly updated: TouchedPage[];
  readonly moved: MovedPage[];
  readonly deletedFixturePaths: string[];
  readonly outside: { readonly created: string[]; readonly updated: string[]; readonly deleted: string[] };
  readonly indexUpdated: boolean;
  readonly indexContent: string;
  readonly livePaths: string[];
  readonly allPaths: string[];
  readonly backlinkBodies: ReadonlyArray<{ readonly path: string; readonly locale: string; readonly content: string }>;
}

export interface DiffWikiRequest {
  readonly pre: readonly WikiRow[];
  readonly post: readonly WikiRow[];
  readonly content: Readonly<Record<string, string>>;
  readonly scenarioNo: number;
}

export function isSandboxPath(p: string): boolean;
export function parseTranscript(text: string): TranscriptMeta;
export function scenarioNoFromUnit(unitId: string): number;
export function diffWiki(req: DiffWikiRequest): WikiDiff;
