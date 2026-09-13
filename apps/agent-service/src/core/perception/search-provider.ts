export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export interface WebSearchProvider {
  search(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<WebSearchResult[]>;
  readonly available: boolean;
}

export class UnavailableWebSearchProvider implements WebSearchProvider {
  readonly available = false;

  async search(): Promise<WebSearchResult[]> {
    throw new Error("web_search_unavailable");
  }
}

export const defaultWebSearchProvider: WebSearchProvider =
  new UnavailableWebSearchProvider();
