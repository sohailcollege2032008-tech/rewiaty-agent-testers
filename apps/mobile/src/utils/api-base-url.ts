/**
 * The cloud API origin comes from the build environment. An empty value is the supported
 * "offline build" case: screens keep their calm «الخدمة السحابية لسه مش مفعّلة» notice instead of
 * failing on the first tap.
 */
export function getConfiguredApiBaseUrl(
  raw: string | undefined = process.env.EXPO_PUBLIC_API_BASE_URL,
): string {
  return typeof raw === 'string' ? raw.trim() : '';
}
