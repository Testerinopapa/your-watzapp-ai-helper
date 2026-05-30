import { useEffect } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import OverviewHeader from "@/components/dashboard/OverviewHeader";
import SidebarRail from "@/components/dashboard/SidebarRail";
import StatTiles from "@/components/dashboard/StatTiles";
import ActivitySection from "@/components/dashboard/ActivitySection";
import DownloadInstallSection from "@/components/dashboard/DownloadInstallSection";
import HelpSection from "@/components/dashboard/HelpSection";
import ConnectExtension from "@/components/ConnectExtension";
import FlaggedReviewSection from "@/components/dashboard/FlaggedReviewSection";
import AppointmentsSection from "@/components/dashboard/AppointmentsSection";
import doodleBg from "@/assets/dashboard-doodles.jpg";
import doodleBgDark from "@/assets/dashboard-doodles-dark.jpg";
import { useTheme } from "@/components/ThemeProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { GOOGLE_CALENDAR_SCOPE_ERROR } from "@/hooks/useGoogleCalendar";

const Dashboard = () => {
  const { theme } = useTheme();
  const bg = theme === "dark" ? doodleBgDark : doodleBg;
  const overlay =
    theme === "dark"
      ? "linear-gradient(to bottom, hsl(var(--background) / 0.78), hsl(var(--background) / 0.88))"
      : "linear-gradient(to bottom, hsl(var(--background) / 0.92), hsl(var(--muted) / 0.85))";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (!gcal) return;
    // clean URL
    params.delete("gcal");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if (gcal === "error") {
      toast({ title: "Google Calendar", description: "Connection failed. Please try again.", variant: "destructive" });
      return;
    }
    if (gcal === "scope_missing") {
      toast({ title: "Google Calendar permission needed", description: GOOGLE_CALENDAR_SCOPE_ERROR, variant: "destructive" });
      return;
    }
    if (gcal === "ok") {
      toast({ title: "Google Calendar connected", description: "Syncing your upcoming events…" });
      supabase.functions.invoke("google-calendar-sync", { body: {} }).then(({ data, error }) => {
        if (error) {
          toast({ title: "Sync failed", description: GOOGLE_CALENDAR_SCOPE_ERROR, variant: "destructive" });
        } else if (data) {
          toast({ title: "Synced", description: `${(data as { synced: number }).synced} events imported.` });
        }
      });
    }
  }, []);



  return (
    <div
      className="min-h-screen bg-background"
      style={{
        backgroundImage: `${overlay}, url(${bg})`,
        backgroundRepeat: "no-repeat, repeat",
        backgroundSize: "cover, 480px auto",
        backgroundAttachment: "fixed, fixed",
      }}
    >
      <DashboardHeader />

      <div className="container mx-auto px-4 md:px-6 py-8">
        <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-8">
          <SidebarRail />

          <main className="space-y-10 min-w-0">
            <OverviewHeader />
            <StatTiles />

            <div id="review">
              <FlaggedReviewSection />
            </div>

            <div id="appointments">
              <AppointmentsSection />
            </div>

            <ActivitySection />

            <div id="extension">
              <ConnectExtension />
            </div>

            <DownloadInstallSection />

            <HelpSection />
          </main>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
