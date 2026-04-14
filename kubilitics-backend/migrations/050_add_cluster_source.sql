-- Add source column to clusters to distinguish kubeconfig-watched vs user-uploaded.
-- kubeconfig-watched clusters are eligible for auto-removal when their context
-- disappears from the watched kubeconfig file. Upload-sourced clusters are not.

ALTER TABLE clusters ADD COLUMN source TEXT NOT NULL DEFAULT 'kubeconfig';

-- Retroactively flag any clusters that came from a user-uploaded kubeconfig so
-- the first sync pass after upgrade doesn't auto-remove them.
UPDATE clusters
   SET source = 'upload'
 WHERE kubeconfig_path LIKE '%/.kubilitics/kubeconfigs/%'
    OR kubeconfig_path LIKE '%\.kubilitics\kubeconfigs\%';
