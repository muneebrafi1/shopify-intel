/**
 * Response types for pages and components: `import type { StoreDetail } from '~/server/api/v1/types'`.
 * All are inferred from the zod schemas, so they always match what the API returns.
 */
export type {
  AppRef,
  CategoryRef,
  ComparisonLink,
  Cta,
  EntityRef,
  Facet,
  Hints,
  Image,
  PageInfo,
  PageTypeRef,
  Price,
  Rect,
  ScreenshotDetail,
  ScreenshotThumb,
  SectionCard,
  SectionTypeRef,
  ShotSection,
  StoreRef,
  StoreThemeInfo,
  ThemeRef,
  UsageStat,
} from './schemas/common.ts';
export type { Envelope, ErrorCode, ErrorResponse, ResponseMeta } from './schemas/envelope.ts';
export type {
  ListStoresInput,
  ListStoresOutput,
  SimilarStore,
  StoreApp,
  StoreDetail,
  StoreFacets,
  StoreListItem,
  StorePage,
} from './schemas/stores.ts';
export type {
  CuratedStoreShots,
  ListThemesInput,
  ListThemesOutput,
  PriceBand,
  ThemeDetail,
  ThemeListItem,
  ThemeStoreRow,
} from './schemas/themes.ts';
export type {
  AppCategory,
  AppDetail,
  AppFacts,
  AppListItem,
  AppPlan,
  AppPricing,
  AppStoreRow,
  ListAppsInput,
  ListAppsOutput,
} from './schemas/apps.ts';
export type {
  Alternatives,
  ComparisonDetail,
  ListAlternativesOutput,
  ListComparisonsOutput,
  MatrixRow,
} from './schemas/compare.ts';
export type {
  ListSectionTypesOutput,
  ListSectionsInput,
  ListSectionsOutput,
  SectionDetail,
  SectionTypeInfo,
} from './schemas/sections.ts';
export type {
  ApiIndex,
  CreateRemovalRequestInput,
  DataMeta,
  RemovalRequestReceipt,
  RemovalScope,
  SearchHit,
  SearchInput,
  SearchKind,
  SearchOutput,
  TeardownDetail,
  TeardownListItem,
  TeardownNote,
} from './schemas/misc.ts';
