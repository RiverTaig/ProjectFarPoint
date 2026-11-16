import { createClient } from 'npm:@supabase/supabase-js@2';
import { createContentHandler } from '../_shared/offlineContent.ts';
import { TrailError } from '../_shared/trailExtraction.ts';

Deno.serve(createContentHandler({
  config: () => {
    const password = Deno.env.get('OFFLINE_SUBMISSION_PASSWORD');
    const ownerId = Deno.env.get('OFFLINE_ACTIVITY_OWNER_ID');
    return password && ownerId ? {password,ownerId} : null;
  },
  allowedOrigins: () => (Deno.env.get('APP_ORIGINS') ?? 'https://projectfarpoint.com').split(',').map((value) => value.trim()).filter(Boolean),
  store: () => {
    const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    return {
      async activity(requestId,ownerId) {
        const {data:r,error} = await client.from('offline_activity_requests').select('result_activity_id').eq('id',requestId).eq('owner_user_id',ownerId).eq('status','completed').maybeSingle();
        if (error) throw error; if (!r?.result_activity_id) return null;
        const {data:a,error:ae} = await client.from('project_activities').select('id,text_description').eq('id',r.result_activity_id)
          .eq('owner_user_id',ownerId).eq('source','offline').eq('offline_request_id',requestId).is('superseded_by_activity_id',null).maybeSingle();
        if (ae) throw ae; if (!a) return null;
        const {data:images,error:ie} = await client.from('project_activity_images').select('name,caption,storage_bucket,storage_path').eq('activity_id',a.id).order('sort_order').order('created_at');
        if (ie) throw ie;
        return {id:a.id,description:a.text_description ?? '',images:(images ?? []).map((image) => ({name:image.name,caption:image.caption,
          url:client.storage.from(image.storage_bucket).getPublicUrl(image.storage_path).data.publicUrl}))};
      },
      async upload(path,bytes,contentType) {
        const {error} = await client.storage.from('project-activity-images').upload(path,bytes,{contentType,upsert:false,cacheControl:'31536000'});
        // Content-addressed paths make a repeated upload of identical bytes safe.
        if (error && !['409','Duplicate'].includes(String(error.statusCode))) throw error;
      },
      async save(requestId,ownerId,description,image) {
        const {error} = await client.rpc('pfp_save_offline_content',{p_request:requestId,p_owner:ownerId,p_description:description,p_image:image});
        if (error?.message.includes('IMAGE_NAME_IN_USE')) throw new TrailError('IMAGE_NAME_IN_USE','That image name is already used for a different photo. Choose another name.');
        if (error?.message.includes('IMAGE_LIMIT_REACHED')) throw new TrailError('IMAGE_LIMIT_REACHED','An activity can have at most 10 images.');
        if (error) throw error;
      },
    };
  },
}));
