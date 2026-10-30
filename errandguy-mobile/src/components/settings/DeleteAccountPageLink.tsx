import React from 'react';
import { PublicPageLink } from './PublicPageLink';

interface DeleteAccountPageLinkProps {
  label?: string;
  className?: string;
}

/**
 * Opens the public "delete your account" web page — how to delete an account,
 * and how to ask for it without the app. Linked from every place the app
 * describes account deletion.
 */
export function DeleteAccountPageLink({
  label = 'Delete your account on the web',
  className = '',
}: DeleteAccountPageLinkProps) {
  return <PublicPageLink page="deleteAccount" label={label} className={className} />;
}
