import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppRelease } from "@t-box/app-contracts";
/** Deployment operator configures the artifact origin; model output and user parameters never choose URLs. */
export function resolveWebDeployment(release: AppRelease): AppRelease {
  if (release.runtime.type !== "web") return release;
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const path = resolve(root, "apps", release.appId, "deployment.local.json");
  if (!existsSync(path)) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "Production application deployment requires a configured HTTPS artifact origin",
      );
    return release;
  }
  const config = JSON.parse(readFileSync(path, "utf8")) as {
    origin: string;
    artifact: string;
  };
  const origin = new URL(config.origin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.hash ||
    origin.search ||
    !/^[a-f0-9]{64}$/.test(config.artifact)
  )
    throw new Error("Invalid application deployment configuration");
  const manifest = JSON.parse(
    readFileSync(
      resolve(
        root,
        "output",
        "app-artifacts",
        release.appId,
        config.artifact,
        "artifact.json",
      ),
      "utf8",
    ),
  );
  if (
    manifest.appId !== release.appId ||
    manifest.protocol !== 1 ||
    manifest.digest !== config.artifact ||
    createHash("sha256")
      .update(JSON.stringify(manifest.files))
      .digest("hex") !== config.artifact
  )
    throw new Error("Application artifact digest does not match deployment");
  return {
    ...release,
    releaseId: `${release.appId}-${release.manifest.version}-${createHash(
      "sha256",
    )
      .update(origin.origin + config.artifact)
      .digest("hex")
      .slice(0, 20)}`,
    runtime: {
      type: "web",
      entryUrl: `${origin.origin}/${release.appId}/${config.artifact}/`,
      integrity: `sha256-${config.artifact}`,
    },
  };
}
