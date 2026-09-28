import { AppHeader } from "@/components/layout/app-header";
import { CommandPalette } from "@/components/command-palette";
import { TargetPickerModal } from "@/components/targets/target-picker-modal";

export default async function ShellDialogFixture({
  searchParams,
}: {
  searchParams: Promise<{ targets?: string }>;
}) {
  const targetsEnabled = (await searchParams).targets === "1";
  return (
    <>
      <AppHeader targetsEnabled={targetsEnabled} />
      <main><button type="button">Outside control</button></main>
      <CommandPalette />
      <TargetPickerModal />
    </>
  );
}
