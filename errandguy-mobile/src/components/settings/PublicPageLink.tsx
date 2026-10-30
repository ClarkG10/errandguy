import React from 'react';
import { Pressable, Text } from 'react-native';
import { PUBLIC_PAGES, type PublicPage } from '../../constants/legal';
import { toast } from '../../stores/toastStore';
import { openWebPage } from '../../utils/browser';

/**
 * Open one of the public pages the API host serves (constants/legal). Shared
 * by every link and menu row that points at them, so a page that can't open
 * always says where to find it instead of failing silently.
 */
export async function openPublicPage(page: PublicPage): Promise<void> {
  const { url } = PUBLIC_PAGES[page];
  const opened = await openWebPage(url);
  if (!opened) toast.error(`Couldn’t open the page. You can visit ${url} in your browser.`);
}

interface PublicPageLinkProps {
  page: PublicPage;
  /** Defaults to the page's own name. */
  label?: string;
  className?: string;
}

/** An inline text link to a public page (Terms, Privacy, account deletion). */
export function PublicPageLink({ page, label, className = '' }: PublicPageLinkProps) {
  const { label: pageLabel, url } = PUBLIC_PAGES[page];
  const text = label ?? pageLabel;
  return (
    <Pressable
      onPress={() => void openPublicPage(page)}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      accessibilityRole="link"
      accessibilityLabel={text}
      accessibilityHint={`Opens ${url}`}
      // Left-aligned unless the caller places it (self-center etc.).
      className={`${className.includes('self-') ? '' : 'self-start '}${className}`}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
    >
      <Text className="text-[13px] font-montserrat-semi text-primary underline">{text}</Text>
    </Pressable>
  );
}
