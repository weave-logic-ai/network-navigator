import { ProfileView } from "@/components/profile/profile-view";

export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Your imported LinkedIn profile data and activity summary
        </p>
      </div>
      <ProfileView />
    </div>
  );
}
