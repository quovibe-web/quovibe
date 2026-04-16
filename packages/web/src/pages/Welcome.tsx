// packages/web/src/pages/Welcome.tsx — stub placeholder (Task 5b.1 fleshes this out)
import { useEffect } from 'react';

export default function Welcome() {
  useEffect(() => { document.title = 'Welcome · quovibe'; }, []);
  return <div>welcome</div>;
}
