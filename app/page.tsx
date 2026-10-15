// The chat widget (mounted in app/layout.tsx) renders full-page over this
// route once it hydrates client-side — see components/ChatWidget.tsx's
// `isHome` branch. components/RouteTransition.tsx suppresses this route's
// output entirely, so this component never actually renders; it exists only
// because the app router requires a page.tsx for "/" to resolve.
export default function Home() {
  return null;
}
