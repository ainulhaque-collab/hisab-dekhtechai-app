import React, { useEffect, useState } from 'react';
import { Workspace } from '../contracts/types';
import { workspaceMedia } from '../storage/workspaceMedia';
export function WorkspaceAvatar({ workspace }: { workspace?: Workspace | null }) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    setImage(null);
    const load = () => { if (workspace) workspaceMedia.get(workspace.id, workspace.ownerSubjectHash).then(data => { if (mounted) setImage(data); }).catch(() => { if (mounted) setImage(null); }); };
    load(); window.addEventListener('hisab-workspace-media', load);
    return () => { mounted = false; window.removeEventListener('hisab-workspace-media', load); };
  }, [workspace?.id, workspace?.ownerSubjectHash]);
  return image ? <img src={image} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" /> :
    <span aria-hidden="true" className="w-8 h-8 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center shrink-0">{workspace?.name.trim().slice(0, 1) || '◈'}</span>;
}
