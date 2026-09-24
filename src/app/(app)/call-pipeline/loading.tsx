import { PageLoading } from "@/components/page-loading";

/** Shown while this screen loads — see `PageLoading`. */
export default function Loading() {
  return <PageLoading title="Pipeline" what="the pipeline" />;
}
