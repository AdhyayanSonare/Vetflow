import { Link } from "wouter";
import { Page } from "@/components/common/Page";
import { EmptyState } from "@/components/common/States";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <Page>
      <EmptyState title="Page not found" description="The page you opened does not exist, or it has moved." action={<Button asChild><Link href="/">Go to Today</Link></Button>} />
    </Page>
  );
}
