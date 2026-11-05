import { useLayoutEffect, useState } from "react";
import { useNavigation, useSegments } from "expo-router";
import { doneTrace, type DoneNavigationSource, type DoneRouteObservation } from "./doneTrace";

export function useDoneRouteObservation() {
  const [observation] = useState(() => doneTrace.routeObservation());
  return observation;
}

/** Rendered only when qualification is enabled, so shipping builds read no extra navigation context. */
export function DoneRouteObserver({ observation }: { observation: DoneRouteObservation }) {
  const navigation = useNavigation() as unknown as DoneNavigationSource;
  useLayoutEffect(() => observation.attach(navigation), [navigation, observation]);
  return null;
}

/** Rendered only when qualification is enabled, so shipping builds add no route-store subscription. */
export function DoneBranchObserver() {
  const segments: readonly string[] = useSegments();
  useLayoutEffect(() => { doneTrace.processStart(); }, []);
  useLayoutEffect(() => { doneTrace.routeBranch(segments); }, [segments]);
  return null;
}
