import { useEffect, useState } from "react";
import { devices } from "../lib/catalog";
import { readProfile, type Profile } from "../lib/profile";
import AlertForm from "./AlertForm";

export default function SavedAlertForm({ fallback, fallbackName }: { fallback: Profile; fallbackName: string }) {
  const [profile, setProfile] = useState(fallback);
  const [name, setName] = useState(fallbackName);
  useEffect(() => {
    const saved = readProfile();
    if (!saved) return;
    const device = devices.find((item) => item.slug === saved.deviceId);
    if (!device) return;
    setProfile(saved);
    setName(device.name);
  }, []);
  return <AlertForm profile={profile} deviceName={name} />;
}
