/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as gameLogs from "../gameLogs.js";
import type * as gameSessions from "../gameSessions.js";
import type * as games from "../games.js";
import type * as highScores from "../highScores.js";
import type * as lib_finishGame from "../lib/finishGame.js";
import type * as lib_gameModel from "../lib/gameModel.js";
import type * as lib_recordScore from "../lib/recordScore.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_sessionGame from "../lib/sessionGame.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  gameLogs: typeof gameLogs;
  gameSessions: typeof gameSessions;
  games: typeof games;
  highScores: typeof highScores;
  "lib/finishGame": typeof lib_finishGame;
  "lib/gameModel": typeof lib_gameModel;
  "lib/recordScore": typeof lib_recordScore;
  "lib/rules": typeof lib_rules;
  "lib/sessionGame": typeof lib_sessionGame;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
