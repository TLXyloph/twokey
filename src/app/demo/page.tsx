import { connection } from "next/server";
import { BoardHeader } from "@/ui/studio/board-header";
import { StudioLoader } from "@/ui/studio/studio-loader";
import { boardCssVars } from "@/ui/studio/tokens";

/**
 * The demo dashboard (/demo): the board header, then AG Studio filling the rest of the viewport.
 * A server component, so it can read the AG Studio licence key from the server's environment. The
 * key is a client-side licence by design (Studio validates it in the browser), so handing it to the
 * client is expected; it is never logged and never a NEXT_PUBLIC_ variable.
 */
export default async function DemoPage() {
  // Render per request, so the key is read at runtime rather than baked in at build time.
  await connection();
  return (
    <main className="board" style={boardCssVars}>
      <BoardHeader />
      <div className="board__studio">
        <StudioLoader licenseKey={process.env.AG_STUDIO_LICENSE_KEY} />
      </div>
    </main>
  );
}
