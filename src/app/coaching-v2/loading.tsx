/**
 * Shown the instant a hub link is clicked, so the route commits right away
 * (and the sidebar swaps) while the server builds the page.
 */
export default function Loading() {
  return (
    <div className="h2-loading" aria-busy="true">
      <div className="h2-loading-bar" />
      <div className="h2-loading-bar" style={{ width: "40%" }} />
      <div className="h2-loading-block" />
    </div>
  );
}
