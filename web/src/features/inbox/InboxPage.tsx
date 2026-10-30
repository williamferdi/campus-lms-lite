import { Bell, MessageSquareOff } from "lucide-react";
import { useSearchParams } from "react-router";
import { PageContainer } from "../../components/layout/AppShell";
import { Card, EmptyState, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui";
import { NotificationsPanel } from "../account/AccountPages";

/**
 * Inbox. Notifications come from the live API. Person-to-person messaging is not implemented
 * on the server, so the Messages tab says so instead of showing sample conversations.
 */
export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "messages" ? "messages" : "notifications";
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="Inbox" description="Announcements, deadlines, submissions, grades and feedback from your courses." />
      <Tabs value={tab} onValueChange={(v) => setParams(v === "messages" ? { tab: v } : {}, { replace: true })}>
        <TabsList label="Inbox sections">
          <TabsTrigger value="notifications">
            <Bell aria-hidden /> Notifications
          </TabsTrigger>
          <TabsTrigger value="messages">
            <MessageSquareOff aria-hidden /> Messages
          </TabsTrigger>
        </TabsList>
        <TabsContent value="notifications">
          <NotificationsPanel />
        </TabsContent>
        <TabsContent value="messages">
          <Card>
            <EmptyState
              icon={<MessageSquareOff className="size-6" />}
              title="Direct messaging isn't available yet"
              description="This release doesn't include person-to-person messages. Use course discussions, or contact your instructor through your institution's usual channels."
            />
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
