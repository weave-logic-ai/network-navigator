"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Briefcase,
  GraduationCap,
  Award,
  Heart,
  MessageSquare,
  Mail,
  Phone,
  MapPin,
  Globe,
  Calendar,
  Users,
  BookOpen,
  Building2,
  Target,
  Star,
  ThumbsUp,
  FolderOpen,
  Loader2,
} from "lucide-react";

interface OwnerProfile {
  id: string;
  version: number;
  is_current: boolean;
  first_name: string;
  last_name: string;
  headline: string;
  summary: string;
  industry: string;
  location: string;
  geo_location: string;
  zip_code: string;
  email: string;
  phone: string;
  twitter_handles: string[];
  websites: string[];
  registered_at: string;
  skills: string[];
  positions: Record<string, string>[];
  education: Record<string, string>[];
  certifications: Record<string, string>[];
  honors: Record<string, string>[];
  organizations: Record<string, string>[];
  volunteering: Record<string, string>[];
  projects: Record<string, string>[];
  courses: Record<string, string>[];
  learning_courses: Record<string, string>[];
  company_follows: string[];
  endorsements_given_count: number;
  endorsements_received_count: number;
  recommendations_given_count: number;
  recommendations_received_count: number;
  total_messages_sent: number;
  total_messages_received: number;
  total_conversations: number;
  invitations_sent: number;
  invitations_received: number;
  ad_targeting: Record<string, unknown>;
  imported_files: string[];
  imported_at: string;
  updated_at: string;
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="rounded-md bg-muted p-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </div>
    </div>
  );
}

function SectionList({
  items,
  titleKey,
  subtitleKey,
  dateKeys,
  emptyText,
}: {
  items: Record<string, string>[];
  titleKey: string;
  subtitleKey?: string;
  dateKeys?: string[];
  emptyText: string;
}) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const title =
          item[titleKey] ||
          item.name ||
          item.title ||
          item.organization ||
          Object.values(item)[0] ||
          "Untitled";
        const subtitle = subtitleKey ? item[subtitleKey] : undefined;
        const dates = dateKeys
          ?.map((k) => item[k])
          .filter(Boolean)
          .join(" - ");

        return (
          <div key={i} className="rounded-md border p-3">
            <p className="font-medium text-sm">{title}</p>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
            {dates && (
              <p className="text-xs text-muted-foreground mt-1">{dates}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ProfileView() {
  const [profile, setProfile] = useState<OwnerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/import/full-profile")
      .then((r) => r.json())
      .then((res) => {
        setProfile(res.data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="m-6">
        <CardContent className="pt-6">
          <p className="text-destructive">Failed to load profile: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card className="m-6">
        <CardContent className="pt-6 text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            No profile imported yet. Go to{" "}
            <a href="/import" className="text-primary underline">
              Import
            </a>{" "}
            to upload your LinkedIn data export.
          </p>
        </CardContent>
      </Card>
    );
  }

  const initials =
    (profile.first_name?.[0] || "") + (profile.last_name?.[0] || "");
  const fullName = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ");

  const adTargetEntries = Object.entries(profile.ad_targeting || {});

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-xl bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-bold">{fullName}</h2>
                <Badge variant="secondary">v{profile.version}</Badge>
              </div>
              {profile.headline && (
                <p className="text-muted-foreground mt-1">
                  {profile.headline}
                </p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-muted-foreground">
                {profile.industry && (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {profile.industry}
                  </span>
                )}
                {(profile.geo_location || profile.location) && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {profile.geo_location || profile.location}
                  </span>
                )}
                {profile.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" />
                    {profile.email}
                  </span>
                )}
                {profile.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {profile.phone}
                  </span>
                )}
                {profile.registered_at && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    Member since{" "}
                    {new Date(profile.registered_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              {profile.websites && profile.websites.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {profile.websites.map((url, i) => (
                    <a
                      key={i}
                      href={url.startsWith("http") ? url : `https://${url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Globe className="h-3 w-3" />
                      {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
          {profile.summary && (
            <>
              <Separator className="my-4" />
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {profile.summary}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Skills"
          value={profile.skills?.length || 0}
          icon={Star}
        />
        <StatCard
          label="Conversations"
          value={profile.total_conversations}
          icon={MessageSquare}
        />
        <StatCard
          label="Messages Sent"
          value={profile.total_messages_sent}
          icon={Mail}
        />
        <StatCard
          label="Endorsements"
          value={profile.endorsements_received_count}
          icon={ThumbsUp}
        />
        <StatCard
          label="Recommendations"
          value={profile.recommendations_received_count}
          icon={Award}
        />
        <StatCard
          label="Following"
          value={profile.company_follows?.length || 0}
          icon={Users}
        />
      </div>

      {/* Tabbed Sections */}
      <Tabs defaultValue="experience">
        <TabsList className="w-full justify-start flex-wrap h-auto">
          <TabsTrigger value="experience">
            <Briefcase className="h-3.5 w-3.5 mr-1.5" />
            Experience
          </TabsTrigger>
          <TabsTrigger value="education">
            <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
            Education
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Star className="h-3.5 w-3.5 mr-1.5" />
            Skills
          </TabsTrigger>
          <TabsTrigger value="activity">
            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="interests">
            <Heart className="h-3.5 w-3.5 mr-1.5" />
            Interests
          </TabsTrigger>
          <TabsTrigger value="targeting">
            <Target className="h-3.5 w-3.5 mr-1.5" />
            Ad Targeting
          </TabsTrigger>
          <TabsTrigger value="data">
            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
            Import Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="experience" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Briefcase className="h-4 w-4" /> Positions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SectionList
                items={profile.positions}
                titleKey="title"
                subtitleKey="company_name"
                dateKeys={["started_on", "finished_on"]}
                emptyText="No positions found"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="h-4 w-4" /> Certifications
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SectionList
                items={profile.certifications}
                titleKey="name"
                subtitleKey="authority"
                dateKeys={["started_on"]}
                emptyText="No certifications found"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FolderOpen className="h-4 w-4" /> Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SectionList
                items={profile.projects}
                titleKey="title"
                subtitleKey="description"
                dateKeys={["started_on", "finished_on"]}
                emptyText="No projects found"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="education" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <GraduationCap className="h-4 w-4" /> Education
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SectionList
                items={profile.education}
                titleKey="school_name"
                subtitleKey="degree_name"
                dateKeys={["start_date", "end_date"]}
                emptyText="No education found"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> LinkedIn Learning
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SectionList
                items={profile.learning_courses}
                titleKey="title"
                subtitleKey="content_type"
                dateKeys={["completed_at"]}
                emptyText="No learning courses found"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> Courses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SectionList
                items={profile.courses}
                titleKey="name"
                subtitleKey="number"
                emptyText="No courses found"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Skills ({profile.skills?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {profile.skills && profile.skills.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {profile.skills.map((skill, i) => (
                    <Badge key={i} variant="secondary">
                      {skill}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No skills found
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Messaging</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Messages Sent</span>
                  <span className="font-medium">
                    {profile.total_messages_sent.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Messages Received
                  </span>
                  <span className="font-medium">
                    {profile.total_messages_received.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Conversations</span>
                  <span className="font-medium">
                    {profile.total_conversations.toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Invitations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sent</span>
                  <span className="font-medium">{profile.invitations_sent}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Received</span>
                  <span className="font-medium">
                    {profile.invitations_received}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Endorsements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Given</span>
                  <span className="font-medium">
                    {profile.endorsements_given_count}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Received</span>
                  <span className="font-medium">
                    {profile.endorsements_received_count}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommendations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Given</span>
                  <span className="font-medium">
                    {profile.recommendations_given_count}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Received</span>
                  <span className="font-medium">
                    {profile.recommendations_received_count}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {profile.honors && profile.honors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Award className="h-4 w-4" /> Honors & Awards
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SectionList
                  items={profile.honors}
                  titleKey="title"
                  subtitleKey="issuer"
                  dateKeys={["issued_on"]}
                  emptyText="No honors found"
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="interests" className="space-y-4 mt-4">
          {profile.volunteering && profile.volunteering.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Heart className="h-4 w-4" /> Volunteering
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SectionList
                  items={profile.volunteering}
                  titleKey="role"
                  subtitleKey="organization"
                  dateKeys={["started_on", "finished_on"]}
                  emptyText="No volunteering found"
                />
              </CardContent>
            </Card>
          )}
          {profile.organizations && profile.organizations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Organizations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SectionList
                  items={profile.organizations}
                  titleKey="name"
                  subtitleKey="position"
                  dateKeys={["started_on", "finished_on"]}
                  emptyText="No organizations found"
                />
              </CardContent>
            </Card>
          )}
          {profile.company_follows && profile.company_follows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Companies Following (
                  {profile.company_follows.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {profile.company_follows.map((company, i) => (
                    <Badge key={i} variant="outline">
                      {company}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="targeting" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" /> LinkedIn Ad Targeting Data
              </CardTitle>
            </CardHeader>
            <CardContent>
              {adTargetEntries.length > 0 ? (
                <div className="space-y-3">
                  {adTargetEntries.map(([key, value]) => (
                    <div key={key}>
                      <p className="text-sm font-medium capitalize">
                        {key.replace(/_/g, " ")}
                      </p>
                      <div className="mt-1">
                        {Array.isArray(value) ? (
                          <div className="flex flex-wrap gap-1">
                            {(value as string[]).map((v, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {v}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {String(value)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No ad targeting data found
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Version</span>
                <span className="font-medium">{profile.version}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Imported At</span>
                <span className="font-medium">
                  {new Date(profile.imported_at).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Files Processed</span>
                <span className="font-medium">
                  {profile.imported_files?.length || 0}
                </span>
              </div>
              <Separator />
              <p className="text-sm font-medium">Imported Files</p>
              <div className="flex flex-wrap gap-1">
                {profile.imported_files?.map((file, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {file}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
