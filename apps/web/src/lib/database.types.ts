
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_budgets": {
                  Row: {
                    "activity_id": string,"amount": number,"item_id": string,"project_id": string,"tenant_id": string
                  }
                  Insert: {
                    "activity_id": string,"amount": number,"item_id": string,"project_id": string,"tenant_id": string
                  }
                  Update: {
                    "activity_id"?: string,"amount"?: number,"item_id"?: string,"project_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_budgets_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: true
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_budgets_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_budgets_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_budgets_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_constraints": {
                  Row: {
                    "activity_id": string,"created_at": string,"created_by": string | null,"id": string,"kind": string,"project_id": string,"task_id": string,"tenant_id": string
                  }
                  Insert: {
                    "activity_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": string,"project_id": string,"task_id": string,"tenant_id": string
                  }
                  Update: {
                    "activity_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"project_id"?: string,"task_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_constraints_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_constraints_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_constraints_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_constraints_task_id_fkey"
      columns: ["task_id"]
isOneToOne: true
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_constraints_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_readiness_checks": {
                  Row: {
                    "activity_id": string,"checked_at": string,"checked_by": string | null,"project_id": string,"tenant_id": string
                  }
                  Insert: {
                    "activity_id": string,"checked_at"?: string,"checked_by"?: string | null,"project_id": string,"tenant_id": string
                  }
                  Update: {
                    "activity_id"?: string,"checked_at"?: string,"checked_by"?: string | null,"project_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_readiness_checks_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: true
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_readiness_checks_checked_by_fkey"
      columns: ["checked_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_readiness_checks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_readiness_checks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"attachments": {
                  Row: {
                    "caption": string | null,"comment_id": string | null,"created_at": string,"created_by": string | null,"entity_id": string,"entity_type": string,"file_id": string,"id": string,"project_id": string,"tenant_id": string
                  }
                  Insert: {
                    "caption"?: string | null,"comment_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id": string,"entity_type": string,"file_id": string,"id"?: string,"project_id": string,"tenant_id": string
                  }
                  Update: {
                    "caption"?: string | null,"comment_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string,"entity_type"?: string,"file_id"?: string,"id"?: string,"project_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_entity_type_fkey"
      columns: ["entity_type"]
isOneToOne: false
      referencedRelation: "entity_types"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "attachments_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "attachments_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attachments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_activity": {
                  Row: {
                    "actor_id": string | null,"board_id": string,"card_id": string,"created_at": string,"data": NonNullable<Json>,"id": string,"kind": string,"tenant_id": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"board_id": string,"card_id": string,"created_at"?: string,"data"?: NonNullable<Json>,"id"?: string,"kind": string,"tenant_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"board_id"?: string,"card_id"?: string,"created_at"?: string,"data"?: NonNullable<Json>,"id"?: string,"kind"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_activity_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_activity_board_id_card_id_fkey"
      columns: ["board_id","card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_activity_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_automation_runs": {
                  Row: {
                    "automation_id": string,"card_id": string,"fired_at": string,"key": string
                  }
                  Insert: {
                    "automation_id": string,"card_id": string,"fired_at"?: string,"key": string
                  }
                  Update: {
                    "automation_id"?: string,"card_id"?: string,"fired_at"?: string,"key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_automation_runs_automation_id_fkey"
      columns: ["automation_id"]
isOneToOne: false
      referencedRelation: "board_automations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_automation_runs_card_id_fkey"
      columns: ["card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["id"]
    }
                  ]
                },"board_automations": {
                  Row: {
                    "actions": NonNullable<Json>,"board_id": string,"created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"position": number,"tenant_id": string,"title": string,"trigger": string,"trigger_days": number | null,"trigger_list_id": string | null,"updated_at": string
                  }
                  Insert: {
                    "actions": NonNullable<Json>,"board_id": string,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"position"?: number,"tenant_id"?: string,"title"?: string,"trigger": string,"trigger_days"?: number | null,"trigger_list_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "actions"?: NonNullable<Json>,"board_id"?: string,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"position"?: number,"tenant_id"?: string,"title"?: string,"trigger"?: string,"trigger_days"?: number | null,"trigger_list_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_automations_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_automations_board_id_trigger_list_id_fkey"
      columns: ["board_id","trigger_list_id"]
isOneToOne: false
      referencedRelation: "board_lists"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_automations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_automations_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_card_attachments": {
                  Row: {
                    "board_id": string,"card_id": string,"created_at": string,"created_by": string | null,"document_id": string | null,"file_id": string | null,"id": string,"linked_card_id": string | null,"name": string,"tenant_id": string
                  }
                  Insert: {
                    "board_id": string,"card_id": string,"created_at"?: string,"created_by"?: string | null,"document_id"?: string | null,"file_id"?: string | null,"id"?: string,"linked_card_id"?: string | null,"name": string,"tenant_id"?: string
                  }
                  Update: {
                    "board_id"?: string,"card_id"?: string,"created_at"?: string,"created_by"?: string | null,"document_id"?: string | null,"file_id"?: string | null,"id"?: string,"linked_card_id"?: string | null,"name"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_card_attachments_board_id_card_id_fkey"
      columns: ["board_id","card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_card_attachments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_card_attachments_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_card_attachments_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_card_attachments_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "board_card_attachments_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_card_attachments_linked_card_id_fkey"
      columns: ["linked_card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_card_attachments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_card_labels": {
                  Row: {
                    "board_id": string,"card_id": string,"label_id": string,"tenant_id": string
                  }
                  Insert: {
                    "board_id": string,"card_id": string,"label_id": string,"tenant_id"?: string
                  }
                  Update: {
                    "board_id"?: string,"card_id"?: string,"label_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_card_labels_board_id_card_id_fkey"
      columns: ["board_id","card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_card_labels_board_id_label_id_fkey"
      columns: ["board_id","label_id"]
isOneToOne: false
      referencedRelation: "board_labels"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_card_labels_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_card_members": {
                  Row: {
                    "board_id": string,"card_id": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "board_id": string,"card_id": string,"tenant_id"?: string,"user_id": string
                  }
                  Update: {
                    "board_id"?: string,"card_id"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_card_members_board_id_card_id_fkey"
      columns: ["board_id","card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_card_members_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_card_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"board_card_viewers": {
                  Row: {
                    "board_id": string,"card_id": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "board_id": string,"card_id": string,"tenant_id"?: string,"user_id": string
                  }
                  Update: {
                    "board_id"?: string,"card_id"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_card_viewers_board_id_card_id_fkey"
      columns: ["board_id","card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_card_viewers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_card_viewers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"board_cards": {
                  Row: {
                    "archived_at": string | null,"board_id": string,"completed": boolean,"cover": string | null,"cover_attachment_id": string | null,"created_at": string,"created_by": string | null,"description": string,"due_at": string | null,"due_done": boolean,"has_description": boolean | null,"id": string,"list_id": string,"position": number,"start_date": string | null,"tenant_id": string,"title": string,"updated_at": string,"visibility": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"board_id": string,"completed"?: boolean,"cover"?: string | null,"cover_attachment_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"due_at"?: string | null,"due_done"?: boolean,"has_description"?: never,"id"?: string,"list_id": string,"position"?: number,"start_date"?: string | null,"tenant_id"?: string,"title": string,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"board_id"?: string,"completed"?: boolean,"cover"?: string | null,"cover_attachment_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"due_at"?: string | null,"due_done"?: boolean,"has_description"?: never,"id"?: string,"list_id"?: string,"position"?: number,"start_date"?: string | null,"tenant_id"?: string,"title"?: string,"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_cards_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_cards_board_id_list_id_fkey"
      columns: ["board_id","list_id"]
isOneToOne: false
      referencedRelation: "board_lists"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_cards_cover_attachment_id_fkey"
      columns: ["cover_attachment_id"]
isOneToOne: false
      referencedRelation: "board_card_attachments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_cards_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_cards_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_checklist_items": {
                  Row: {
                    "board_id": string,"card_id": string,"checklist_id": string,"created_at": string,"done": boolean,"id": string,"position": number,"tenant_id": string,"title": string
                  }
                  Insert: {
                    "board_id": string,"card_id": string,"checklist_id": string,"created_at"?: string,"done"?: boolean,"id"?: string,"position"?: number,"tenant_id"?: string,"title": string
                  }
                  Update: {
                    "board_id"?: string,"card_id"?: string,"checklist_id"?: string,"created_at"?: string,"done"?: boolean,"id"?: string,"position"?: number,"tenant_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_checklist_items_board_id_card_id_fkey"
      columns: ["board_id","card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_checklist_items_card_id_checklist_id_fkey"
      columns: ["card_id","checklist_id"]
isOneToOne: false
      referencedRelation: "board_checklists"
      referencedColumns: ["card_id","id"]
    },{
      foreignKeyName: "board_checklist_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_checklists": {
                  Row: {
                    "board_id": string,"card_id": string,"created_at": string,"id": string,"position": number,"tenant_id": string,"title": string
                  }
                  Insert: {
                    "board_id": string,"card_id": string,"created_at"?: string,"id"?: string,"position"?: number,"tenant_id"?: string,"title": string
                  }
                  Update: {
                    "board_id"?: string,"card_id"?: string,"created_at"?: string,"id"?: string,"position"?: number,"tenant_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_checklists_board_id_card_id_fkey"
      columns: ["board_id","card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_checklists_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_comments": {
                  Row: {
                    "attachment_id": string | null,"author_id": string | null,"board_id": string,"body": string,"card_id": string,"created_at": string,"edited_at": string | null,"id": string,"is_system": boolean,"tenant_id": string
                  }
                  Insert: {
                    "attachment_id"?: string | null,"author_id"?: string | null,"board_id": string,"body": string,"card_id": string,"created_at"?: string,"edited_at"?: string | null,"id"?: string,"is_system"?: boolean,"tenant_id"?: string
                  }
                  Update: {
                    "attachment_id"?: string | null,"author_id"?: string | null,"board_id"?: string,"body"?: string,"card_id"?: string,"created_at"?: string,"edited_at"?: string | null,"id"?: string,"is_system"?: boolean,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_comments_attachment_id_fkey"
      columns: ["attachment_id"]
isOneToOne: false
      referencedRelation: "board_card_attachments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_comments_board_id_card_id_fkey"
      columns: ["board_id","card_id"]
isOneToOne: false
      referencedRelation: "board_cards"
      referencedColumns: ["board_id","id"]
    },{
      foreignKeyName: "board_comments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_labels": {
                  Row: {
                    "board_id": string,"color": string,"created_at": string,"id": string,"name": string,"position": number,"tenant_id": string
                  }
                  Insert: {
                    "board_id": string,"color": string,"created_at"?: string,"id"?: string,"name"?: string,"position"?: number,"tenant_id"?: string
                  }
                  Update: {
                    "board_id"?: string,"color"?: string,"created_at"?: string,"id"?: string,"name"?: string,"position"?: number,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_labels_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_labels_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_lists": {
                  Row: {
                    "archived_at": string | null,"board_id": string,"created_at": string,"id": string,"position": number,"tenant_id": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"board_id": string,"created_at"?: string,"id"?: string,"position"?: number,"tenant_id"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"board_id"?: string,"created_at"?: string,"id"?: string,"position"?: number,"tenant_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_lists_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_lists_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"board_members": {
                  Row: {
                    "added_at": string,"added_by": string | null,"board_id": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"board_id": string,"tenant_id"?: string,"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"board_id"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_members_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_members_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_members_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"board_stars": {
                  Row: {
                    "board_id": string,"created_at": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "board_id": string,"created_at"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Update: {
                    "board_id"?: string,"created_at"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "board_stars_board_id_fkey"
      columns: ["board_id"]
isOneToOne: false
      referencedRelation: "boards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_stars_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "board_stars_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"boards": {
                  Row: {
                    "all_staff": boolean,"background": string,"background_image": string | null,"closed_at": string | null,"created_at": string,"created_by": string | null,"description": string,"id": string,"kind": string,"owner_id": string | null,"project_id": string,"tenant_id": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "all_staff"?: boolean,"background"?: string,"background_image"?: string | null,"closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"kind": string,"owner_id"?: string | null,"project_id": string,"tenant_id"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "all_staff"?: boolean,"background"?: string,"background_image"?: string | null,"closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"kind"?: string,"owner_id"?: string | null,"project_id"?: string,"tenant_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "boards_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "boards_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "boards_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "boards_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_actuals": {
                  Row: {
                    "activity_id": string | null,"amount": number,"commitment_id": string | null,"counterparty": string | null,"created_at": string,"created_by": string | null,"currency": string | null,"deleted_at": string | null,"doc_date": string,"doc_number": string | null,"doc_type": string,"fx_rate": number | null,"id": string,"item_id": string,"note": string | null,"orig_amount": number | null,"project_id": string,"source": string | null,"tenant_id": string
                  }
                  Insert: {
                    "activity_id"?: string | null,"amount": number,"commitment_id"?: string | null,"counterparty"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"deleted_at"?: string | null,"doc_date"?: string,"doc_number"?: string | null,"doc_type"?: string,"fx_rate"?: number | null,"id"?: string,"item_id": string,"note"?: string | null,"orig_amount"?: number | null,"project_id": string,"source"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "activity_id"?: string | null,"amount"?: number,"commitment_id"?: string | null,"counterparty"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"deleted_at"?: string | null,"doc_date"?: string,"doc_number"?: string | null,"doc_type"?: string,"fx_rate"?: number | null,"id"?: string,"item_id"?: string,"note"?: string | null,"orig_amount"?: number | null,"project_id"?: string,"source"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_actuals_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_actuals_commitment_id_fkey"
      columns: ["commitment_id"]
isOneToOne: false
      referencedRelation: "budget_commitments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_actuals_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_actuals_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_actuals_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_actuals_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_amounts": {
                  Row: {
                    "amount": number,"item_id": string,"project_id": string,"tenant_id": string,"version_id": string
                  }
                  Insert: {
                    "amount": number,"item_id": string,"project_id": string,"tenant_id": string,"version_id": string
                  }
                  Update: {
                    "amount"?: number,"item_id"?: string,"project_id"?: string,"tenant_id"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_amounts_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_amounts_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_amounts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_amounts_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "budget_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_commitments": {
                  Row: {
                    "amount": number,"counterparty": string | null,"created_at": string,"created_by": string | null,"currency": string | null,"deleted_at": string | null,"doc_number": string | null,"fx_rate": number | null,"id": string,"item_id": string,"note": string | null,"orig_amount": number | null,"project_id": string,"signed_on": string | null,"status": string,"tenant_id": string,"title": string
                  }
                  Insert: {
                    "amount": number,"counterparty"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"deleted_at"?: string | null,"doc_number"?: string | null,"fx_rate"?: number | null,"id"?: string,"item_id": string,"note"?: string | null,"orig_amount"?: number | null,"project_id": string,"signed_on"?: string | null,"status"?: string,"tenant_id": string,"title": string
                  }
                  Update: {
                    "amount"?: number,"counterparty"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string | null,"deleted_at"?: string | null,"doc_number"?: string | null,"fx_rate"?: number | null,"id"?: string,"item_id"?: string,"note"?: string | null,"orig_amount"?: number | null,"project_id"?: string,"signed_on"?: string | null,"status"?: string,"tenant_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_commitments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_commitments_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_commitments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_commitments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_etc": {
                  Row: {
                    "etc_amount": number,"item_id": string,"note": string | null,"project_id": string,"tenant_id": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "etc_amount": number,"item_id": string,"note"?: string | null,"project_id": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "etc_amount"?: number,"item_id"?: string,"note"?: string | null,"project_id"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_etc_item_id_fkey"
      columns: ["item_id"]
isOneToOne: true
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_etc_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_etc_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_etc_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_forecast": {
                  Row: {
                    "amount": number,"item_id": string,"month": string,"project_id": string,"tenant_id": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "amount": number,"item_id": string,"month": string,"project_id": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "amount"?: number,"item_id"?: string,"month"?: string,"project_id"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_forecast_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_forecast_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_forecast_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_forecast_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_settings": {
                  Row: {
                    "closed_through": string | null,"project_id": string,"tenant_id": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "closed_through"?: string | null,"project_id": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "closed_through"?: string | null,"project_id"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_settings_project_id_fkey"
      columns: ["project_id"]
isOneToOne: true
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_settings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_versions": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"created_at": string,"created_by": string | null,"id": string,"name": string,"note": string | null,"number": number,"project_id": string,"status": string,"tenant_id": string
                  }
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"note"?: string | null,"number": number,"project_id": string,"status"?: string,"tenant_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"note"?: string | null,"number"?: number,"project_id"?: string,"status"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_versions_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_versions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_versions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"cbs_items": {
                  Row: {
                    "alt_name": string | null,"code": string,"cost_type": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"name": string,"parent_id": string | null,"project_id": string,"sort": number,"source_code": string | null,"tenant_id": string
                  }
                  Insert: {
                    "alt_name"?: string | null,"code": string,"cost_type"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"name": string,"parent_id"?: string | null,"project_id": string,"sort"?: number,"source_code"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "alt_name"?: string | null,"code"?: string,"cost_type"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"name"?: string,"parent_id"?: string | null,"project_id"?: string,"sort"?: number,"source_code"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cbs_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cbs_items_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cbs_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cbs_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"change_requests": {
                  Row: {
                    "assessment_note": string,"cost_impact": number | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string,"deleted_at": string | null,"description": string,"id": string,"initiator_id": string | null,"key": string,"number": number,"project_id": string,"reason": string,"schedule_impact_days": number | null,"status": string,"tenant_id": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "assessment_note"?: string,"cost_impact"?: number | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string,"deleted_at"?: string | null,"description"?: string,"id"?: string,"initiator_id"?: string | null,"key": string,"number": number,"project_id": string,"reason"?: string,"schedule_impact_days"?: number | null,"status"?: string,"tenant_id": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "assessment_note"?: string,"cost_impact"?: number | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string,"deleted_at"?: string | null,"description"?: string,"id"?: string,"initiator_id"?: string | null,"key"?: string,"number"?: number,"project_id"?: string,"reason"?: string,"schedule_impact_days"?: number | null,"status"?: string,"tenant_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "change_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_requests_initiator_id_fkey"
      columns: ["initiator_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_requests_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_requests_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_attachments": {
                  Row: {
                    "created_at": string,"duration_sec": number | null,"id": string,"kind": string,"message_id": string,"mime": string,"name": string,"size_bytes": number,"storage_key": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"duration_sec"?: number | null,"id"?: string,"kind": string,"message_id": string,"mime": string,"name": string,"size_bytes": number,"storage_key": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"duration_sec"?: number | null,"id"?: string,"kind"?: string,"message_id"?: string,"mime"?: string,"name"?: string,"size_bytes"?: number,"storage_key"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_attachments_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "chat_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_attachments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_channel_members": {
                  Row: {
                    "added_by": string | null,"channel_id": string,"created_at": string,"user_id": string
                  }
                  Insert: {
                    "added_by"?: string | null,"channel_id": string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "added_by"?: string | null,"channel_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_channel_members_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_channel_members_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "chat_channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_channel_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_channels": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"discipline_id": string | null,"id": string,"kind": string,"last_message_at": string | null,"name": string | null,"organization_id": string | null,"project_id": string | null,"tenant_id": string,"user_a": string | null,"user_b": string | null
                  }
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"discipline_id"?: string | null,"id"?: string,"kind": string,"last_message_at"?: string | null,"name"?: string | null,"organization_id"?: string | null,"project_id"?: string | null,"tenant_id": string,"user_a"?: string | null,"user_b"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"discipline_id"?: string | null,"id"?: string,"kind"?: string,"last_message_at"?: string | null,"name"?: string | null,"organization_id"?: string | null,"project_id"?: string | null,"tenant_id"?: string,"user_a"?: string | null,"user_b"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_channels_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_channels_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_channels_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_channels_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_channels_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_channels_user_a_fkey"
      columns: ["user_a"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_channels_user_b_fkey"
      columns: ["user_b"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_messages": {
                  Row: {
                    "author_id": string,"body": string,"channel_id": string,"created_at": string,"deleted_at": string | null,"edited_at": string | null,"id": string,"tenant_id": string
                  }
                  Insert: {
                    "author_id"?: string,"body": string,"channel_id": string,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"tenant_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"channel_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_messages_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "chat_channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_reactions": {
                  Row: {
                    "created_at": string,"emoji": string,"message_id": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"emoji": string,"message_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"emoji"?: string,"message_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_reactions_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "chat_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_reactions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_reads": {
                  Row: {
                    "channel_id": string,"last_read_at": string,"user_id": string
                  }
                  Insert: {
                    "channel_id": string,"last_read_at"?: string,"user_id": string
                  }
                  Update: {
                    "channel_id"?: string,"last_read_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_reads_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "chat_channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_reads_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"checklist_items": {
                  Row: {
                    "checklist_id": string,"created_at": string,"done": boolean,"done_at": string | null,"done_by": string | null,"id": string,"project_id": string,"sort": number,"tenant_id": string,"text": string
                  }
                  Insert: {
                    "checklist_id": string,"created_at"?: string,"done"?: boolean,"done_at"?: string | null,"done_by"?: string | null,"id"?: string,"project_id": string,"sort"?: number,"tenant_id": string,"text": string
                  }
                  Update: {
                    "checklist_id"?: string,"created_at"?: string,"done"?: boolean,"done_at"?: string | null,"done_by"?: string | null,"id"?: string,"project_id"?: string,"sort"?: number,"tenant_id"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklist_items_checklist_id_fkey"
      columns: ["checklist_id"]
isOneToOne: false
      referencedRelation: "checklists"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_items_done_by_fkey"
      columns: ["done_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklist_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"checklists": {
                  Row: {
                    "created_at": string,"created_by": string | null,"entity_id": string,"entity_type": string,"id": string,"project_id": string,"sort": number,"tenant_id": string,"title": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"entity_id": string,"entity_type": string,"id"?: string,"project_id": string,"sort"?: number,"tenant_id": string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"entity_id"?: string,"entity_type"?: string,"id"?: string,"project_id"?: string,"sort"?: number,"tenant_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklists_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklists_entity_type_fkey"
      columns: ["entity_type"]
isOneToOne: false
      referencedRelation: "entity_types"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "checklists_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checklists_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"comments": {
                  Row: {
                    "author_id": string,"body": NonNullable<Json>,"body_text": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"edited_at": string | null,"entity_id": string,"entity_type": string,"id": string,"is_decision": boolean,"is_note": boolean,"mentions": NonNullable<Json>,"parent_id": string | null,"project_id": string,"tenant_id": string,"updated_at": string,"updated_by": string | null,"version": number,"visibility": string
                  }
                  Insert: {
                    "author_id": string,"body": NonNullable<Json>,"body_text"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"edited_at"?: string | null,"entity_id": string,"entity_type": string,"id"?: string,"is_decision"?: boolean,"is_note"?: boolean,"mentions"?: NonNullable<Json>,"parent_id"?: string | null,"project_id": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"visibility"?: string
                  }
                  Update: {
                    "author_id"?: string,"body"?: NonNullable<Json>,"body_text"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"edited_at"?: string | null,"entity_id"?: string,"entity_type"?: string,"id"?: string,"is_decision"?: boolean,"is_note"?: boolean,"mentions"?: NonNullable<Json>,"parent_id"?: string | null,"project_id"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_entity_type_fkey"
      columns: ["entity_type"]
isOneToOne: false
      referencedRelation: "entity_types"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "comments_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"daily_logs": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"created_at": string,"created_by": string | null,"equipment": NonNullable<Json>,"events": string | null,"id": string,"log_date": string,"manpower": NonNullable<Json>,"notes": string | null,"project_id": string,"status": string,"stop_reason": string | null,"submitted_at": string | null,"temperature_c": number | null,"tenant_id": string,"updated_at": string,"visitors": string | null,"weather": string | null,"work_stopped": boolean,"works": string | null
                  }
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"equipment"?: NonNullable<Json>,"events"?: string | null,"id"?: string,"log_date": string,"manpower"?: NonNullable<Json>,"notes"?: string | null,"project_id": string,"status"?: string,"stop_reason"?: string | null,"submitted_at"?: string | null,"temperature_c"?: number | null,"tenant_id": string,"updated_at"?: string,"visitors"?: string | null,"weather"?: string | null,"work_stopped"?: boolean,"works"?: string | null
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"equipment"?: NonNullable<Json>,"events"?: string | null,"id"?: string,"log_date"?: string,"manpower"?: NonNullable<Json>,"notes"?: string | null,"project_id"?: string,"status"?: string,"stop_reason"?: string | null,"submitted_at"?: string | null,"temperature_c"?: number | null,"tenant_id"?: string,"updated_at"?: string,"visitors"?: string | null,"weather"?: string | null,"work_stopped"?: boolean,"works"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_logs_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_logs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_logs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_logs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"design_sprints": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"created_by": string | null,"discipline_id": string | null,"ends_on": string,"goal": string | null,"id": string,"name": string,"project_id": string,"started_at": string | null,"starts_on": string,"status": string,"tenant_id": string
                  }
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"discipline_id"?: string | null,"ends_on": string,"goal"?: string | null,"id"?: string,"name": string,"project_id": string,"started_at"?: string | null,"starts_on": string,"status"?: string,"tenant_id": string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"discipline_id"?: string | null,"ends_on"?: string,"goal"?: string | null,"id"?: string,"name"?: string,"project_id"?: string,"started_at"?: string | null,"starts_on"?: string,"status"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "design_sprints_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "design_sprints_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "design_sprints_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "design_sprints_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"disciplines": {
                  Row: {
                    "code": string,"color": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"lead_user_id": string | null,"name": string,"parent_id": string | null,"project_id": string | null,"sort": number,"template_id": string | null,"tenant_id": string,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  Insert: {
                    "code": string,"color"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"lead_user_id"?: string | null,"name": string,"parent_id"?: string | null,"project_id"?: string | null,"sort"?: number,"template_id"?: string | null,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "code"?: string,"color"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"lead_user_id"?: string | null,"name"?: string,"parent_id"?: string | null,"project_id"?: string | null,"sort"?: number,"template_id"?: string | null,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "disciplines_lead_user_id_fkey"
      columns: ["lead_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disciplines_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disciplines_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disciplines_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "disciplines_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"document_acks": {
                  Row: {
                    "acked_at": string | null,"notified_at": string,"project_id": string,"tenant_id": string,"user_id": string,"version_id": string
                  }
                  Insert: {
                    "acked_at"?: string | null,"notified_at"?: string,"project_id": string,"tenant_id": string,"user_id": string,"version_id": string
                  }
                  Update: {
                    "acked_at"?: string | null,"notified_at"?: string,"project_id"?: string,"tenant_id"?: string,"user_id"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_acks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_acks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_acks_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_acks_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "document_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_acks_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["current_version_id"]
    },{
      foreignKeyName: "document_acks_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["latest_version_id"]
    }
                  ]
                },"document_folders": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"name": string,"parent_id": string | null,"project_id": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"name": string,"parent_id"?: string | null,"project_id": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"name"?: string,"parent_id"?: string | null,"project_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_folders_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_folders_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_folders_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_folders_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"document_links": {
                  Row: {
                    "created_at": string,"created_by": string | null,"document_id": string,"entity_id": string,"entity_type": string,"id": string,"project_id": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"document_id": string,"entity_id": string,"entity_type": string,"id"?: string,"project_id": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"document_id"?: string,"entity_id"?: string,"entity_type"?: string,"id"?: string,"project_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_links_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_links_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_links_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_links_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_links_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"document_orgs": {
                  Row: {
                    "document_id": string,"organization_id": string,"tenant_id": string
                  }
                  Insert: {
                    "document_id": string,"organization_id": string,"tenant_id": string
                  }
                  Update: {
                    "document_id"?: string,"organization_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_orgs_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_orgs_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_orgs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_orgs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"document_versions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"document_id": string,"file_id": string,"id": string,"note": string | null,"preview_file_id": string | null,"project_id": string,"published_at": string | null,"published_by": string | null,"revision": string,"status": string,"tenant_id": string,"version_no": number
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"document_id": string,"file_id": string,"id"?: string,"note"?: string | null,"preview_file_id"?: string | null,"project_id": string,"published_at"?: string | null,"published_by"?: string | null,"revision"?: string,"status"?: string,"tenant_id": string,"version_no": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"document_id"?: string,"file_id"?: string,"id"?: string,"note"?: string | null,"preview_file_id"?: string | null,"project_id"?: string,"published_at"?: string | null,"published_by"?: string | null,"revision"?: string,"status"?: string,"tenant_id"?: string,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_versions_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_versions_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_versions_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "document_versions_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_versions_preview_file_id_fkey"
      columns: ["preview_file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "document_versions_preview_file_id_fkey"
      columns: ["preview_file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_versions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_versions_published_by_fkey"
      columns: ["published_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_versions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "code": string | null,"created_at": string,"created_by": string | null,"current_version_id": string | null,"deleted_at": string | null,"discipline_id": string | null,"doc_type": string,"folder_id": string | null,"id": string,"project_id": string,"requires_ack": boolean,"tenant_id": string,"title": string,"updated_at": string,"visibility": string
                  }
                  Insert: {
                    "code"?: string | null,"created_at"?: string,"created_by"?: string | null,"current_version_id"?: string | null,"deleted_at"?: string | null,"discipline_id"?: string | null,"doc_type"?: string,"folder_id"?: string | null,"id"?: string,"project_id": string,"requires_ack"?: boolean,"tenant_id": string,"title": string,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "code"?: string | null,"created_at"?: string,"created_by"?: string | null,"current_version_id"?: string | null,"deleted_at"?: string | null,"discipline_id"?: string | null,"doc_type"?: string,"folder_id"?: string | null,"id"?: string,"project_id"?: string,"requires_ack"?: boolean,"tenant_id"?: string,"title"?: string,"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_current_version_fk"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "document_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_current_version_fk"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["current_version_id"]
    },{
      foreignKeyName: "documents_current_version_fk"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["latest_version_id"]
    },{
      foreignKeyName: "documents_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_folder_id_fkey"
      columns: ["folder_id"]
isOneToOne: false
      referencedRelation: "document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"dwg_views": {
                  Row: {
                    "created_at": string,"error": string | null,"file_id": string,"progress": string | null,"project_id": string,"requested_by": string | null,"status": string,"tenant_id": string,"updated_at": string,"urn": string | null
                  }
                  Insert: {
                    "created_at"?: string,"error"?: string | null,"file_id": string,"progress"?: string | null,"project_id": string,"requested_by"?: string | null,"status"?: string,"tenant_id": string,"updated_at"?: string,"urn"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"error"?: string | null,"file_id"?: string,"progress"?: string | null,"project_id"?: string,"requested_by"?: string | null,"status"?: string,"tenant_id"?: string,"updated_at"?: string,"urn"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "dwg_views_file_id_fkey"
      columns: ["file_id"]
isOneToOne: true
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "dwg_views_file_id_fkey"
      columns: ["file_id"]
isOneToOne: true
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dwg_views_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dwg_views_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dwg_views_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"email_outbox": {
                  Row: {
                    "attempts": number,"claimed_at": string | null,"created_at": string,"id": string,"kind": string,"last_error": string | null,"notification_id": string | null,"payload": NonNullable<Json>,"send_after": string,"sent_at": string | null,"status": string,"tenant_id": string,"to_email": string,"user_id": string
                  }
                  Insert: {
                    "attempts"?: number,"claimed_at"?: string | null,"created_at"?: string,"id"?: string,"kind": string,"last_error"?: string | null,"notification_id"?: string | null,"payload"?: NonNullable<Json>,"send_after"?: string,"sent_at"?: string | null,"status"?: string,"tenant_id": string,"to_email": string,"user_id": string
                  }
                  Update: {
                    "attempts"?: number,"claimed_at"?: string | null,"created_at"?: string,"id"?: string,"kind"?: string,"last_error"?: string | null,"notification_id"?: string | null,"payload"?: NonNullable<Json>,"send_after"?: string,"sent_at"?: string | null,"status"?: string,"tenant_id"?: string,"to_email"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_outbox_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notifications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_outbox_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_outbox_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"entity_events": {
                  Row: {
                    "actor_id": string | null,"changes": NonNullable<Json>,"entity_id": string,"entity_type": string,"event_type": string,"id": string,"occurred_at": string,"project_id": string | null,"tenant_id": string,"visibility": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"changes"?: NonNullable<Json>,"entity_id": string,"entity_type": string,"event_type": string,"id"?: string,"occurred_at"?: string,"project_id"?: string | null,"tenant_id": string,"visibility"?: string
                  }
                  Update: {
                    "actor_id"?: string | null,"changes"?: NonNullable<Json>,"entity_id"?: string,"entity_type"?: string,"event_type"?: string,"id"?: string,"occurred_at"?: string,"project_id"?: string | null,"tenant_id"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entity_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_events_entity_type_fkey"
      columns: ["entity_type"]
isOneToOne: false
      referencedRelation: "entity_types"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "entity_events_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"entity_image_versions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"file_id": string,"id": string,"image_id": string,"note": string | null,"project_id": string,"tenant_id": string,"version_no": number
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"file_id": string,"id"?: string,"image_id": string,"note"?: string | null,"project_id": string,"tenant_id": string,"version_no": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"file_id"?: string,"id"?: string,"image_id"?: string,"note"?: string | null,"project_id"?: string,"tenant_id"?: string,"version_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "entity_image_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_image_versions_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "entity_image_versions_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_image_versions_image_id_fkey"
      columns: ["image_id"]
isOneToOne: false
      referencedRelation: "entity_images"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_image_versions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_image_versions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"entity_images": {
                  Row: {
                    "caption": string | null,"created_at": string,"created_by": string | null,"entity_id": string,"entity_type": string,"file_id": string,"folder": string,"id": string,"is_cover": boolean,"is_plan": boolean,"project_id": string,"sort": number,"tenant_id": string
                  }
                  Insert: {
                    "caption"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id": string,"entity_type": string,"file_id": string,"folder"?: string,"id"?: string,"is_cover"?: boolean,"is_plan"?: boolean,"project_id": string,"sort"?: number,"tenant_id": string
                  }
                  Update: {
                    "caption"?: string | null,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string,"entity_type"?: string,"file_id"?: string,"folder"?: string,"id"?: string,"is_cover"?: boolean,"is_plan"?: boolean,"project_id"?: string,"sort"?: number,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entity_images_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_images_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "entity_images_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_images_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_images_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"entity_types": {
                  Row: {
                    "code": string,"features": (string)[],"module": string
                  }
                  Insert: {
                    "code": string,"features"?: (string)[],"module": string
                  }
                  Update: {
                    "code"?: string,"features"?: (string)[],"module"?: string
                  }
                  Relationships: [
                    
                  ]
                },"event_reminders_sent": {
                  Row: {
                    "entity_id": string,"kind": string,"sent_at": string,"starts_at": string,"user_id": string
                  }
                  Insert: {
                    "entity_id": string,"kind": string,"sent_at"?: string,"starts_at": string,"user_id": string
                  }
                  Update: {
                    "entity_id"?: string,"kind"?: string,"sent_at"?: string,"starts_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_reminders_sent_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"ffe_contract_prices": {
                  Row: {
                    "contract_id": string,"item_id": string,"project_id": string,"tenant_id": string,"unit_price": number
                  }
                  Insert: {
                    "contract_id": string,"item_id": string,"project_id": string,"tenant_id": string,"unit_price": number
                  }
                  Update: {
                    "contract_id"?: string,"item_id"?: string,"project_id"?: string,"tenant_id"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ffe_contract_prices_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "ffe_contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contract_prices_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "ffe_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contract_prices_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contract_prices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"ffe_contract_scopes": {
                  Row: {
                    "contract_id": string,"location_id": string,"project_id": string,"tenant_id": string
                  }
                  Insert: {
                    "contract_id": string,"location_id": string,"project_id": string,"tenant_id": string
                  }
                  Update: {
                    "contract_id"?: string,"location_id"?: string,"project_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ffe_contract_scopes_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "ffe_contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contract_scopes_location_id_fkey"
      columns: ["location_id"]
isOneToOne: true
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contract_scopes_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contract_scopes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"ffe_contracts": {
                  Row: {
                    "cbs_item_id": string | null,"commitment_id": string | null,"contractor_name": string | null,"contractor_signatory": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"note": string | null,"number": string | null,"organization_id": string | null,"project_id": string,"signed_by_user": string | null,"signed_on": string | null,"status": string,"tenant_id": string,"title": string
                  }
                  Insert: {
                    "cbs_item_id"?: string | null,"commitment_id"?: string | null,"contractor_name"?: string | null,"contractor_signatory"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"note"?: string | null,"number"?: string | null,"organization_id"?: string | null,"project_id": string,"signed_by_user"?: string | null,"signed_on"?: string | null,"status"?: string,"tenant_id": string,"title": string
                  }
                  Update: {
                    "cbs_item_id"?: string | null,"commitment_id"?: string | null,"contractor_name"?: string | null,"contractor_signatory"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"note"?: string | null,"number"?: string | null,"organization_id"?: string | null,"project_id"?: string,"signed_by_user"?: string | null,"signed_on"?: string | null,"status"?: string,"tenant_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ffe_contracts_cbs_item_id_fkey"
      columns: ["cbs_item_id"]
isOneToOne: false
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contracts_commitment_id_fkey"
      columns: ["commitment_id"]
isOneToOne: false
      referencedRelation: "budget_commitments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contracts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contracts_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contracts_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contracts_signed_by_user_fkey"
      columns: ["signed_by_user"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_contracts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"ffe_items": {
                  Row: {
                    "category": string | null,"code": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"document_id": string | null,"id": string,"name": string,"note": string | null,"project_id": string,"tenant_id": string,"unit": string
                  }
                  Insert: {
                    "category"?: string | null,"code": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"document_id"?: string | null,"id"?: string,"name": string,"note"?: string | null,"project_id": string,"tenant_id": string,"unit"?: string
                  }
                  Update: {
                    "category"?: string | null,"code"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"document_id"?: string | null,"id"?: string,"name"?: string,"note"?: string | null,"project_id"?: string,"tenant_id"?: string,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ffe_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_items_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_items_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ffe_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"field_notes": {
                  Row: {
                    "addressee_org_id": string | null,"addressee_user_id": string | null,"author_id": string,"comment_id": string,"created_at": string,"location_id": string,"project_id": string,"resolved_at": string | null,"resolved_by": string | null,"scheme_file_id": string | null,"scheme_version_id": string | null,"scheme_x": number | null,"scheme_y": number | null,"status": string,"task_id": string | null,"tenant_id": string
                  }
                  Insert: {
                    "addressee_org_id"?: string | null,"addressee_user_id"?: string | null,"author_id": string,"comment_id": string,"created_at"?: string,"location_id": string,"project_id": string,"resolved_at"?: string | null,"resolved_by"?: string | null,"scheme_file_id"?: string | null,"scheme_version_id"?: string | null,"scheme_x"?: number | null,"scheme_y"?: number | null,"status"?: string,"task_id"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "addressee_org_id"?: string | null,"addressee_user_id"?: string | null,"author_id"?: string,"comment_id"?: string,"created_at"?: string,"location_id"?: string,"project_id"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null,"scheme_file_id"?: string | null,"scheme_version_id"?: string | null,"scheme_x"?: number | null,"scheme_y"?: number | null,"status"?: string,"task_id"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "field_notes_addressee_org_id_fkey"
      columns: ["addressee_org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_addressee_user_id_fkey"
      columns: ["addressee_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: true
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_scheme_file_id_fkey"
      columns: ["scheme_file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "field_notes_scheme_file_id_fkey"
      columns: ["scheme_file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_scheme_version_id_fkey"
      columns: ["scheme_version_id"]
isOneToOne: false
      referencedRelation: "document_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_scheme_version_id_fkey"
      columns: ["scheme_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["current_version_id"]
    },{
      foreignKeyName: "field_notes_scheme_version_id_fkey"
      columns: ["scheme_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["latest_version_id"]
    },{
      foreignKeyName: "field_notes_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "field_notes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"file_texts": {
                  Row: {
                    "attempts": number,"claimed_at": string | null,"error": string | null,"extracted_at": string | null,"file_id": string,"method": string | null,"project_id": string,"status": string,"tenant_id": string,"text": string | null,"tsv": unknown
                  }
                  Insert: {
                    "attempts"?: number,"claimed_at"?: string | null,"error"?: string | null,"extracted_at"?: string | null,"file_id": string,"method"?: string | null,"project_id": string,"status"?: string,"tenant_id": string,"text"?: string | null,"tsv"?: unknown
                  }
                  Update: {
                    "attempts"?: number,"claimed_at"?: string | null,"error"?: string | null,"extracted_at"?: string | null,"file_id"?: string,"method"?: string | null,"project_id"?: string,"status"?: string,"tenant_id"?: string,"text"?: string | null,"tsv"?: unknown
                  }
                  Relationships: [
                    {
      foreignKeyName: "file_texts_file_id_fkey"
      columns: ["file_id"]
isOneToOne: true
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "file_texts_file_id_fkey"
      columns: ["file_id"]
isOneToOne: true
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "file_texts_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "file_texts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"files": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"meta": NonNullable<Json>,"mime": string,"name": string,"project_id": string,"size_bytes": number,"status": string,"storage_key": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"mime": string,"name": string,"project_id": string,"size_bytes": number,"status"?: string,"storage_key": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"mime"?: string,"name"?: string,"project_id"?: string,"size_bytes"?: number,"status"?: string,"storage_key"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "files_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"inspection_items": {
                  Row: {
                    "comment": string,"created_at": string,"id": string,"position": number,"report_id": string,"resolved_at": string | null,"resolved_by": string | null,"scheme_x": number | null,"scheme_y": number | null,"section_id": string,"status": string | null,"task_id": string | null,"tenant_id": string,"updated_at": string
                  }
                  Insert: {
                    "comment"?: string,"created_at"?: string,"id"?: string,"position": number,"report_id": string,"resolved_at"?: string | null,"resolved_by"?: string | null,"scheme_x"?: number | null,"scheme_y"?: number | null,"section_id": string,"status"?: string | null,"task_id"?: string | null,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "comment"?: string,"created_at"?: string,"id"?: string,"position"?: number,"report_id"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null,"scheme_x"?: number | null,"scheme_y"?: number | null,"section_id"?: string,"status"?: string | null,"task_id"?: string | null,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inspection_items_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "inspection_reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_items_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_items_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "inspection_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_items_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"inspection_photos": {
                  Row: {
                    "caption": string | null,"created_at": string,"created_by": string | null,"file_id": string,"id": string,"item_id": string | null,"report_id": string,"tenant_id": string
                  }
                  Insert: {
                    "caption"?: string | null,"created_at"?: string,"created_by"?: string | null,"file_id": string,"id"?: string,"item_id"?: string | null,"report_id": string,"tenant_id": string
                  }
                  Update: {
                    "caption"?: string | null,"created_at"?: string,"created_by"?: string | null,"file_id"?: string,"id"?: string,"item_id"?: string | null,"report_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inspection_photos_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_photos_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "inspection_photos_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_photos_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "inspection_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_photos_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "inspection_reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_photos_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"inspection_reports": {
                  Row: {
                    "client_name": string | null,"client_sign_file_id": string | null,"client_signed_at": string | null,"cnt_a": number,"cnt_c": number,"cnt_open": number,"cnt_r": number,"contractor_name": string | null,"contractor_org_id": string | null,"contractor_sign_file_id": string | null,"contractor_signed_at": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"inspection_date": string,"issued_at": string | null,"issued_by": string | null,"key": string,"location_id": string | null,"note": string,"number": number,"project_id": string,"result": string | null,"schedule_id": string | null,"scheme_file_id": string | null,"scheme_page": number,"scheme_text": string,"scheme_version_id": string | null,"status": string,"tenant_id": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "client_name"?: string | null,"client_sign_file_id"?: string | null,"client_signed_at"?: string | null,"cnt_a"?: number,"cnt_c"?: number,"cnt_open"?: number,"cnt_r"?: number,"contractor_name"?: string | null,"contractor_org_id"?: string | null,"contractor_sign_file_id"?: string | null,"contractor_signed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"inspection_date"?: string,"issued_at"?: string | null,"issued_by"?: string | null,"key": string,"location_id"?: string | null,"note"?: string,"number": number,"project_id": string,"result"?: string | null,"schedule_id"?: string | null,"scheme_file_id"?: string | null,"scheme_page"?: number,"scheme_text"?: string,"scheme_version_id"?: string | null,"status"?: string,"tenant_id": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "client_name"?: string | null,"client_sign_file_id"?: string | null,"client_signed_at"?: string | null,"cnt_a"?: number,"cnt_c"?: number,"cnt_open"?: number,"cnt_r"?: number,"contractor_name"?: string | null,"contractor_org_id"?: string | null,"contractor_sign_file_id"?: string | null,"contractor_signed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"inspection_date"?: string,"issued_at"?: string | null,"issued_by"?: string | null,"key"?: string,"location_id"?: string | null,"note"?: string,"number"?: number,"project_id"?: string,"result"?: string | null,"schedule_id"?: string | null,"scheme_file_id"?: string | null,"scheme_page"?: number,"scheme_text"?: string,"scheme_version_id"?: string | null,"status"?: string,"tenant_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inspection_reports_client_sign_file_id_fkey"
      columns: ["client_sign_file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "inspection_reports_client_sign_file_id_fkey"
      columns: ["client_sign_file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_contractor_org_id_fkey"
      columns: ["contractor_org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_contractor_sign_file_id_fkey"
      columns: ["contractor_sign_file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "inspection_reports_contractor_sign_file_id_fkey"
      columns: ["contractor_sign_file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_issued_by_fkey"
      columns: ["issued_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_schedule_id_fkey"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "inspection_schedules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_scheme_file_id_fkey"
      columns: ["scheme_file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "inspection_reports_scheme_file_id_fkey"
      columns: ["scheme_file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_scheme_version_id_fkey"
      columns: ["scheme_version_id"]
isOneToOne: false
      referencedRelation: "document_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_reports_scheme_version_id_fkey"
      columns: ["scheme_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["current_version_id"]
    },{
      foreignKeyName: "inspection_reports_scheme_version_id_fkey"
      columns: ["scheme_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["latest_version_id"]
    },{
      foreignKeyName: "inspection_reports_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"inspection_schedules": {
                  Row: {
                    "active": boolean,"contractor_org_id": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"inspector_id": string | null,"location_id": string,"next_due": string,"period_days": number,"project_id": string,"tenant_id": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "active"?: boolean,"contractor_org_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"inspector_id"?: string | null,"location_id": string,"next_due": string,"period_days": number,"project_id": string,"tenant_id": string,"title"?: string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"contractor_org_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"inspector_id"?: string | null,"location_id"?: string,"next_due"?: string,"period_days"?: number,"project_id"?: string,"tenant_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inspection_schedules_contractor_org_id_fkey"
      columns: ["contractor_org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_schedules_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_schedules_inspector_id_fkey"
      columns: ["inspector_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_schedules_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_schedules_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_schedules_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"inspection_sections": {
                  Row: {
                    "code": string | null,"id": string,"ok": boolean,"position": number,"report_id": string,"tenant_id": string,"title": string | null
                  }
                  Insert: {
                    "code"?: string | null,"id"?: string,"ok"?: boolean,"position": number,"report_id": string,"tenant_id": string,"title"?: string | null
                  }
                  Update: {
                    "code"?: string | null,"id"?: string,"ok"?: boolean,"position"?: number,"report_id"?: string,"tenant_id"?: string,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "inspection_sections_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "inspection_reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inspection_sections_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"locations": {
                  Row: {
                    "code": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"elevation": number | null,"id": string,"kind": string,"name": string,"parent_id": string | null,"path": unknown,"position": number | null,"project_id": string,"purpose": string | null,"sort": number,"tenant_id": string,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  Insert: {
                    "code": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"elevation"?: number | null,"id"?: string,"kind": string,"name": string,"parent_id"?: string | null,"path": unknown,"position"?: number | null,"project_id": string,"purpose"?: string | null,"sort"?: number,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"elevation"?: number | null,"id"?: string,"kind"?: string,"name"?: string,"parent_id"?: string | null,"path"?: unknown,"position"?: number | null,"project_id"?: string,"purpose"?: string | null,"sort"?: number,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "locations_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "locations_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "locations_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"mail_accounts": {
                  Row: {
                    "access_expires_at": string | null,"access_token_enc": string | null,"calendar_synced_at": string | null,"connected_at": string,"display_name": string | null,"email": string,"inbox_unread": number | null,"last_error": string | null,"last_ok_at": string | null,"ms_tenant_id": string | null,"notify_checked_at": string | null,"notify_cursor": string | null,"provider": string,"refresh_token_enc": string,"scopes": string,"signature": string | null,"signature_on_reply": boolean,"tenant_id": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "access_expires_at"?: string | null,"access_token_enc"?: string | null,"calendar_synced_at"?: string | null,"connected_at"?: string,"display_name"?: string | null,"email": string,"inbox_unread"?: number | null,"last_error"?: string | null,"last_ok_at"?: string | null,"ms_tenant_id"?: string | null,"notify_checked_at"?: string | null,"notify_cursor"?: string | null,"provider"?: string,"refresh_token_enc": string,"scopes"?: string,"signature"?: string | null,"signature_on_reply"?: boolean,"tenant_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "access_expires_at"?: string | null,"access_token_enc"?: string | null,"calendar_synced_at"?: string | null,"connected_at"?: string,"display_name"?: string | null,"email"?: string,"inbox_unread"?: number | null,"last_error"?: string | null,"last_ok_at"?: string | null,"ms_tenant_id"?: string | null,"notify_checked_at"?: string | null,"notify_cursor"?: string | null,"provider"?: string,"refresh_token_enc"?: string,"scopes"?: string,"signature"?: string | null,"signature_on_reply"?: boolean,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mail_accounts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mail_accounts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"mail_pins": {
                  Row: {
                    "folder": string,"message_id": string,"pinned_at": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "folder": string,"message_id": string,"pinned_at"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Update: {
                    "folder"?: string,"message_id"?: string,"pinned_at"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mail_pins_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mail_pins_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"material_request_approvals": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"id": string,"note": string,"request_id": string,"round": number,"status": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"id"?: string,"note"?: string,"request_id": string,"round": number,"status"?: string,"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"id"?: string,"note"?: string,"request_id"?: string,"round"?: number,"status"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "material_request_approvals_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "material_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_request_approvals_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_request_approvals_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"material_request_lines": {
                  Row: {
                    "est_price": number | null,"id": string,"name": string,"note": string,"position": number,"qty": number,"received_qty": number,"request_id": string,"tenant_id": string,"unit": string
                  }
                  Insert: {
                    "est_price"?: number | null,"id"?: string,"name": string,"note"?: string,"position": number,"qty": number,"received_qty"?: number,"request_id": string,"tenant_id": string,"unit"?: string
                  }
                  Update: {
                    "est_price"?: number | null,"id"?: string,"name"?: string,"note"?: string,"position"?: number,"qty"?: number,"received_qty"?: number,"request_id"?: string,"tenant_id"?: string,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "material_request_lines_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "material_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_request_lines_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"material_request_receipts": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"lines": NonNullable<Json>,"note": string,"request_id": string,"result": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"lines"?: NonNullable<Json>,"note"?: string,"request_id": string,"result": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"lines"?: NonNullable<Json>,"note"?: string,"request_id"?: string,"result"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "material_request_receipts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_request_receipts_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "material_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_request_receipts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"material_requests": {
                  Row: {
                    "amount": number | null,"amount_base": number | null,"approval_note": string,"approval_round": number,"buyer_id": string | null,"cbs_item_id": string | null,"commitment_id": string | null,"created_at": string,"currency": string | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string,"deleted_at": string | null,"delivered_at": string | null,"delivery_note": string,"expected_at": string | null,"forwarder": string,"id": string,"key": string,"needed_by": string | null,"note": string,"number": number,"order_ref": string,"ordered_at": string | null,"over_budget": boolean,"project_id": string,"quote_id": string | null,"receipt": string,"receipt_note": string,"received_by": string | null,"reminded_at": string | null,"requested_by": string | null,"shipped_at": string | null,"single_source_reason": string,"status": string,"status_at": string,"stock_note": string,"stock_status": string,"supplier": string,"tenant_id": string,"tier": number | null,"title": string,"tracking": string,"transport": string,"updated_at": string,"urgent": boolean
                  }
                  Insert: {
                    "amount"?: number | null,"amount_base"?: number | null,"approval_note"?: string,"approval_round"?: number,"buyer_id"?: string | null,"cbs_item_id"?: string | null,"commitment_id"?: string | null,"created_at"?: string,"currency"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string,"deleted_at"?: string | null,"delivered_at"?: string | null,"delivery_note"?: string,"expected_at"?: string | null,"forwarder"?: string,"id"?: string,"key": string,"needed_by"?: string | null,"note"?: string,"number": number,"order_ref"?: string,"ordered_at"?: string | null,"over_budget"?: boolean,"project_id": string,"quote_id"?: string | null,"receipt"?: string,"receipt_note"?: string,"received_by"?: string | null,"reminded_at"?: string | null,"requested_by"?: string | null,"shipped_at"?: string | null,"single_source_reason"?: string,"status"?: string,"status_at"?: string,"stock_note"?: string,"stock_status"?: string,"supplier"?: string,"tenant_id": string,"tier"?: number | null,"title": string,"tracking"?: string,"transport"?: string,"updated_at"?: string,"urgent"?: boolean
                  }
                  Update: {
                    "amount"?: number | null,"amount_base"?: number | null,"approval_note"?: string,"approval_round"?: number,"buyer_id"?: string | null,"cbs_item_id"?: string | null,"commitment_id"?: string | null,"created_at"?: string,"currency"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string,"deleted_at"?: string | null,"delivered_at"?: string | null,"delivery_note"?: string,"expected_at"?: string | null,"forwarder"?: string,"id"?: string,"key"?: string,"needed_by"?: string | null,"note"?: string,"number"?: number,"order_ref"?: string,"ordered_at"?: string | null,"over_budget"?: boolean,"project_id"?: string,"quote_id"?: string | null,"receipt"?: string,"receipt_note"?: string,"received_by"?: string | null,"reminded_at"?: string | null,"requested_by"?: string | null,"shipped_at"?: string | null,"single_source_reason"?: string,"status"?: string,"status_at"?: string,"stock_note"?: string,"stock_status"?: string,"supplier"?: string,"tenant_id"?: string,"tier"?: number | null,"title"?: string,"tracking"?: string,"transport"?: string,"updated_at"?: string,"urgent"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "material_requests_buyer_id_fkey"
      columns: ["buyer_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_cbs_item_id_fkey"
      columns: ["cbs_item_id"]
isOneToOne: false
      referencedRelation: "cbs_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_commitment_id_fkey"
      columns: ["commitment_id"]
isOneToOne: false
      referencedRelation: "budget_commitments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "rfq_quotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "material_requests_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_agenda_items": {
                  Row: {
                    "created_at": string,"duration_min": number | null,"id": string,"meeting_id": string,"notes": string | null,"presenter_id": string | null,"project_id": string,"sort": number,"task_id": string | null,"tenant_id": string,"title": string
                  }
                  Insert: {
                    "created_at"?: string,"duration_min"?: number | null,"id"?: string,"meeting_id": string,"notes"?: string | null,"presenter_id"?: string | null,"project_id": string,"sort"?: number,"task_id"?: string | null,"tenant_id": string,"title": string
                  }
                  Update: {
                    "created_at"?: string,"duration_min"?: number | null,"id"?: string,"meeting_id"?: string,"notes"?: string | null,"presenter_id"?: string | null,"project_id"?: string,"sort"?: number,"task_id"?: string | null,"tenant_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_agenda_items_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_agenda_items_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_agenda_items_presenter_id_fkey"
      columns: ["presenter_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_agenda_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_agenda_items_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_agenda_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_decisions": {
                  Row: {
                    "agenda_item_id": string | null,"created_at": string,"created_by": string | null,"id": string,"meeting_id": string,"number": number,"project_id": string,"tenant_id": string,"text": string
                  }
                  Insert: {
                    "agenda_item_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"meeting_id": string,"number": number,"project_id": string,"tenant_id": string,"text": string
                  }
                  Update: {
                    "agenda_item_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"meeting_id"?: string,"number"?: number,"project_id"?: string,"tenant_id"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_decisions_agenda_item_id_fkey"
      columns: ["agenda_item_id"]
isOneToOne: false
      referencedRelation: "meeting_agenda_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_decisions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_decisions_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_decisions_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_decisions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_decisions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_participants": {
                  Row: {
                    "attendance": string,"meeting_id": string,"project_id": string,"required": boolean,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "attendance"?: string,"meeting_id": string,"project_id": string,"required"?: boolean,"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "attendance"?: string,"meeting_id"?: string,"project_id"?: string,"required"?: boolean,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_participants_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_participants_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_participants_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_participants_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_participants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_recordings": {
                  Row: {
                    "created_at": string,"created_by": string | null,"duration_sec": number,"file_id": string,"id": string,"meeting_id": string,"project_id": string,"session_id": string | null,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"duration_sec"?: number,"file_id": string,"id"?: string,"meeting_id": string,"project_id": string,"session_id"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"duration_sec"?: number,"file_id"?: string,"id"?: string,"meeting_id"?: string,"project_id"?: string,"session_id"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_recordings_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_recordings_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "meeting_recordings_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_recordings_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_recordings_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_recordings_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_recordings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_series": {
                  Row: {
                    "active": boolean,"agenda": (string)[],"created_at": string,"created_by": string | null,"duration_min": number,"ends_on": string | null,"facilitator_id": string | null,"id": string,"participant_ids": (string)[],"place": string | null,"project_id": string,"slots": NonNullable<Json>,"starts_on": string,"tenant_id": string,"title": string,"type": string,"visibility": string
                  }
                  Insert: {
                    "active"?: boolean,"agenda"?: (string)[],"created_at"?: string,"created_by"?: string | null,"duration_min"?: number,"ends_on"?: string | null,"facilitator_id"?: string | null,"id"?: string,"participant_ids"?: (string)[],"place"?: string | null,"project_id": string,"slots": NonNullable<Json>,"starts_on": string,"tenant_id": string,"title": string,"type"?: string,"visibility"?: string
                  }
                  Update: {
                    "active"?: boolean,"agenda"?: (string)[],"created_at"?: string,"created_by"?: string | null,"duration_min"?: number,"ends_on"?: string | null,"facilitator_id"?: string | null,"id"?: string,"participant_ids"?: (string)[],"place"?: string | null,"project_id"?: string,"slots"?: NonNullable<Json>,"starts_on"?: string,"tenant_id"?: string,"title"?: string,"type"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_series_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_series_facilitator_id_fkey"
      columns: ["facilitator_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_series_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_series_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_summaries": {
                  Row: {
                    "accepted": (string)[],"created_at": string,"error": string | null,"finished_at": string | null,"from_parts": boolean,"id": string,"llm_model": string | null,"meeting_id": string,"project_id": string,"recording_id": string,"requested_by": string | null,"result": NonNullable<Json>,"status": string,"stt_model": string | null,"tenant_id": string,"transcript": string,"updated_at": string
                  }
                  Insert: {
                    "accepted"?: (string)[],"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"from_parts"?: boolean,"id"?: string,"llm_model"?: string | null,"meeting_id": string,"project_id": string,"recording_id": string,"requested_by"?: string | null,"result"?: NonNullable<Json>,"status"?: string,"stt_model"?: string | null,"tenant_id": string,"transcript"?: string,"updated_at"?: string
                  }
                  Update: {
                    "accepted"?: (string)[],"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"from_parts"?: boolean,"id"?: string,"llm_model"?: string | null,"meeting_id"?: string,"project_id"?: string,"recording_id"?: string,"requested_by"?: string | null,"result"?: NonNullable<Json>,"status"?: string,"stt_model"?: string | null,"tenant_id"?: string,"transcript"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_summaries_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_summaries_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_summaries_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_summaries_recording_id_fkey"
      columns: ["recording_id"]
isOneToOne: true
      referencedRelation: "meeting_recordings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_summaries_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_summaries_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_transcript_parts": {
                  Row: {
                    "created_at": string,"created_by": string | null,"duration_sec": number,"id": string,"meeting_id": string,"offset_sec": number,"project_id": string,"seq": number,"session_id": string,"speaker": string | null,"tenant_id": string,"text": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"duration_sec"?: number,"id"?: string,"meeting_id": string,"offset_sec"?: number,"project_id": string,"seq": number,"session_id": string,"speaker"?: string | null,"tenant_id": string,"text"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"duration_sec"?: number,"id"?: string,"meeting_id"?: string,"offset_sec"?: number,"project_id"?: string,"seq"?: number,"session_id"?: string,"speaker"?: string | null,"tenant_id"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_transcript_parts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_transcript_parts_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_transcript_parts_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_transcript_parts_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_transcript_parts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"meetings": {
                  Row: {
                    "created_at": string,"created_by": string | null,"duration_min": number,"facilitator_id": string | null,"finished_at": string | null,"id": string,"key": string,"number": number,"original_at": string | null,"place": string | null,"project_id": string,"published_at": string | null,"published_by": string | null,"scheduled_at": string,"series_id": string | null,"started_at": string | null,"status": string,"summary": string | null,"tenant_id": string,"title": string,"type": string,"updated_at": string,"visibility": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"duration_min"?: number,"facilitator_id"?: string | null,"finished_at"?: string | null,"id"?: string,"key": string,"number": number,"original_at"?: string | null,"place"?: string | null,"project_id": string,"published_at"?: string | null,"published_by"?: string | null,"scheduled_at": string,"series_id"?: string | null,"started_at"?: string | null,"status"?: string,"summary"?: string | null,"tenant_id": string,"title": string,"type"?: string,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"duration_min"?: number,"facilitator_id"?: string | null,"finished_at"?: string | null,"id"?: string,"key"?: string,"number"?: number,"original_at"?: string | null,"place"?: string | null,"project_id"?: string,"published_at"?: string | null,"published_by"?: string | null,"scheduled_at"?: string,"series_id"?: string | null,"started_at"?: string | null,"status"?: string,"summary"?: string | null,"tenant_id"?: string,"title"?: string,"type"?: string,"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meetings_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_facilitator_id_fkey"
      columns: ["facilitator_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_published_by_fkey"
      columns: ["published_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_series_id_fkey"
      columns: ["series_id"]
isOneToOne: false
      referencedRelation: "meeting_series"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "category": string,"channel": string,"id": string,"mode": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "category": string,"channel": string,"id"?: string,"mode": string,"tenant_id": string,"user_id"?: string
                  }
                  Update: {
                    "category"?: string,"channel"?: string,"id"?: string,"mode"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preferences_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "actor_id": string | null,"archived_at": string | null,"body": string | null,"category": string,"created_at": string,"entity_id": string | null,"entity_type": string | null,"event_type": string,"group_key": string | null,"id": string,"payload": NonNullable<Json>,"priority": string,"project_id": string | null,"read_at": string | null,"snoozed_until": string | null,"tenant_id": string,"title": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"archived_at"?: string | null,"body"?: string | null,"category": string,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"event_type": string,"group_key"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"priority"?: string,"project_id"?: string | null,"read_at"?: string | null,"snoozed_until"?: string | null,"tenant_id": string,"title": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"archived_at"?: string | null,"body"?: string | null,"category"?: string,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"event_type"?: string,"group_key"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"priority"?: string,"project_id"?: string | null,"read_at"?: string | null,"snoozed_until"?: string | null,"tenant_id"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_entity_type_fkey"
      columns: ["entity_type"]
isOneToOne: false
      referencedRelation: "entity_types"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "notifications_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "contacts": NonNullable<Json>,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"is_active": boolean,"kind": string,"name": string,"short_name": string | null,"tax_id": string | null,"tenant_id": string,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  Insert: {
                    "contacts"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"is_active"?: boolean,"kind": string,"name": string,"short_name"?: string | null,"tax_id"?: string | null,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "contacts"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"is_active"?: boolean,"kind"?: string,"name"?: string,"short_name"?: string | null,"tax_id"?: string | null,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "organizations_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"period_commitments": {
                  Row: {
                    "activity_id": string | null,"added_late": boolean,"created_at": string,"created_by": string | null,"id": string,"location_id": string | null,"note": string | null,"organization_id": string | null,"period_id": string,"project_id": string,"reason": string | null,"reason_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"responsible_id": string | null,"result": string | null,"tenant_id": string,"title": string,"was_ready": boolean
                  }
                  Insert: {
                    "activity_id"?: string | null,"added_late"?: boolean,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string | null,"note"?: string | null,"organization_id"?: string | null,"period_id": string,"project_id": string,"reason"?: string | null,"reason_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"responsible_id"?: string | null,"result"?: string | null,"tenant_id": string,"title": string,"was_ready"?: boolean
                  }
                  Update: {
                    "activity_id"?: string | null,"added_late"?: boolean,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string | null,"note"?: string | null,"organization_id"?: string | null,"period_id"?: string,"project_id"?: string,"reason"?: string | null,"reason_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"responsible_id"?: string | null,"result"?: string | null,"tenant_id"?: string,"title"?: string,"was_ready"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "period_commitments_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "period_commitments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "period_commitments_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "period_commitments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "period_commitments_period_id_fkey"
      columns: ["period_id"]
isOneToOne: false
      referencedRelation: "planning_periods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "period_commitments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "period_commitments_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "period_commitments_responsible_id_fkey"
      columns: ["responsible_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "period_commitments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"permissions": {
                  Row: {
                    "code": string,"external_ok": boolean,"label": string,"module": string,"sort": number,"tenant_only": boolean
                  }
                  Insert: {
                    "code": string,"external_ok"?: boolean,"label": string,"module": string,"sort": number,"tenant_only"?: boolean
                  }
                  Update: {
                    "code"?: string,"external_ok"?: boolean,"label"?: string,"module"?: string,"sort"?: number,"tenant_only"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"personal_items": {
                  Row: {
                    "attendees": NonNullable<Json>,"body": string,"created_at": string,"end_time": string | null,"event_date": string | null,"id": string,"invite_seq": number,"invited_at": string | null,"kind": string,"pinned": boolean,"place": string | null,"source": string | null,"source_uid": string | null,"start_time": string | null,"tenant_id": string,"title": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "attendees"?: NonNullable<Json>,"body"?: string,"created_at"?: string,"end_time"?: string | null,"event_date"?: string | null,"id"?: string,"invite_seq"?: number,"invited_at"?: string | null,"kind": string,"pinned"?: boolean,"place"?: string | null,"source"?: string | null,"source_uid"?: string | null,"start_time"?: string | null,"tenant_id"?: string,"title": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "attendees"?: NonNullable<Json>,"body"?: string,"created_at"?: string,"end_time"?: string | null,"event_date"?: string | null,"id"?: string,"invite_seq"?: number,"invited_at"?: string | null,"kind"?: string,"pinned"?: boolean,"place"?: string | null,"source"?: string | null,"source_uid"?: string | null,"start_time"?: string | null,"tenant_id"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "personal_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "personal_items_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"plan_furniture_marks": {
                  Row: {
                    "created_at": string,"created_by": string | null,"document_id": string,"id": string,"item_id": string,"page": number,"project_id": string,"tenant_id": string,"x": number,"x2": number | null,"y": number,"y2": number | null
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"document_id": string,"id"?: string,"item_id": string,"page"?: number,"project_id": string,"tenant_id": string,"x": number,"x2"?: number | null,"y": number,"y2"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"document_id"?: string,"id"?: string,"item_id"?: string,"page"?: number,"project_id"?: string,"tenant_id"?: string,"x"?: number,"x2"?: number | null,"y"?: number,"y2"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_furniture_marks_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_furniture_marks_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_furniture_marks_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_furniture_marks_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "ffe_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_furniture_marks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_furniture_marks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"plan_objects": {
                  Row: {
                    "color": string | null,"created_at": string,"created_by": string | null,"document_id": string,"geometry": string,"id": string,"label": string,"location_id": string | null,"notes": string,"page": number,"points": NonNullable<Json>,"project_id": string,"rotation": number,"size": number,"specs": NonNullable<Json>,"status": string,"tenant_id": string,"type_code": string,"updated_at": string,"variant": string | null
                  }
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"created_by"?: string | null,"document_id": string,"geometry": string,"id"?: string,"label"?: string,"location_id"?: string | null,"notes"?: string,"page"?: number,"points": NonNullable<Json>,"project_id": string,"rotation"?: number,"size"?: number,"specs"?: NonNullable<Json>,"status"?: string,"tenant_id": string,"type_code": string,"updated_at"?: string,"variant"?: string | null
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"created_by"?: string | null,"document_id"?: string,"geometry"?: string,"id"?: string,"label"?: string,"location_id"?: string | null,"notes"?: string,"page"?: number,"points"?: NonNullable<Json>,"project_id"?: string,"rotation"?: number,"size"?: number,"specs"?: NonNullable<Json>,"status"?: string,"tenant_id"?: string,"type_code"?: string,"updated_at"?: string,"variant"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_objects_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_objects_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_objects_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_objects_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_objects_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_objects_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"plan_scales": {
                  Row: {
                    "document_id": string,"meters_per_width": number,"page": number,"project_id": string,"set_by": string | null,"tenant_id": string,"updated_at": string
                  }
                  Insert: {
                    "document_id": string,"meters_per_width": number,"page"?: number,"project_id": string,"set_by"?: string | null,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "document_id"?: string,"meters_per_width"?: number,"page"?: number,"project_id"?: string,"set_by"?: string | null,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_scales_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_scales_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_scales_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_scales_set_by_fkey"
      columns: ["set_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_scales_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"plan_zones": {
                  Row: {
                    "created_at": string,"created_by": string | null,"document_id": string,"id": string,"location_id": string,"page": number,"points": NonNullable<Json>,"project_id": string,"tenant_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"document_id": string,"id"?: string,"location_id": string,"page"?: number,"points": NonNullable<Json>,"project_id": string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"document_id"?: string,"id"?: string,"location_id"?: string,"page"?: number,"points"?: NonNullable<Json>,"project_id"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_zones_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_zones_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_zones_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_zones_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_zones_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "plan_zones_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"planning_periods": {
                  Row: {
                    "closed_at": string | null,"closed_by": string | null,"created_at": string,"created_by": string | null,"ends_on": string,"force_closed": boolean,"id": string,"note": string | null,"project_id": string,"started_at": string | null,"started_by": string | null,"starts_on": string,"status": string,"tenant_id": string
                  }
                  Insert: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on": string,"force_closed"?: boolean,"id"?: string,"note"?: string | null,"project_id": string,"started_at"?: string | null,"started_by"?: string | null,"starts_on": string,"status"?: string,"tenant_id": string
                  }
                  Update: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string,"force_closed"?: boolean,"id"?: string,"note"?: string | null,"project_id"?: string,"started_at"?: string | null,"started_by"?: string | null,"starts_on"?: string,"status"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "planning_periods_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "planning_periods_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "planning_periods_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "planning_periods_started_by_fkey"
      columns: ["started_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "planning_periods_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"procurement_settings": {
                  Row: {
                    "sla_approval": number,"sla_committee": number,"sla_confirm": number,"sla_sourcing": number,"sla_stock": number,"tenant_id": string,"tier1_limit": number,"tier2_limit": number,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "sla_approval"?: number,"sla_committee"?: number,"sla_confirm"?: number,"sla_sourcing"?: number,"sla_stock"?: number,"tenant_id": string,"tier1_limit"?: number,"tier2_limit"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "sla_approval"?: number,"sla_committee"?: number,"sla_confirm"?: number,"sla_sourcing"?: number,"sla_stock"?: number,"tenant_id"?: string,"tier1_limit"?: number,"tier2_limit"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "procurement_settings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: true
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "procurement_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"progress_entries": {
                  Row: {
                    "activity_id": string,"created_at": string,"created_by": string | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"entry_date": string,"id": string,"method": string,"note": string | null,"percent": number,"project_id": string,"quantity": number | null,"status": string,"tenant_id": string
                  }
                  Insert: {
                    "activity_id": string,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"entry_date": string,"id"?: string,"method": string,"note"?: string | null,"percent": number,"project_id": string,"quantity"?: number | null,"status"?: string,"tenant_id": string
                  }
                  Update: {
                    "activity_id"?: string,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"entry_date"?: string,"id"?: string,"method"?: string,"note"?: string | null,"percent"?: number,"project_id"?: string,"quantity"?: number | null,"status"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "progress_entries_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "progress_entries_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "progress_entries_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "progress_entries_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "progress_entries_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"project_counters": {
                  Row: {
                    "kind": string,"last_number": number,"project_id": string
                  }
                  Insert: {
                    "kind": string,"last_number"?: number,"project_id": string
                  }
                  Update: {
                    "kind"?: string,"last_number"?: number,"project_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_counters_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_geo": {
                  Row: {
                    "lat": number,"lon": number,"place": string | null,"project_id": string,"tenant_id": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "lat": number,"lon": number,"place"?: string | null,"project_id": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "lat"?: number,"lon"?: number,"place"?: string | null,"project_id"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_geo_project_id_fkey"
      columns: ["project_id"]
isOneToOne: true
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_geo_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_geo_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"project_health": {
                  Row: {
                    "color": string,"components": NonNullable<Json>,"computed_at": string,"project_id": string,"score": number,"tenant_id": string
                  }
                  Insert: {
                    "color": string,"components": NonNullable<Json>,"computed_at"?: string,"project_id": string,"score": number,"tenant_id": string
                  }
                  Update: {
                    "color"?: string,"components"?: NonNullable<Json>,"computed_at"?: string,"project_id"?: string,"score"?: number,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_health_project_id_fkey"
      columns: ["project_id"]
isOneToOne: true
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_health_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"project_members": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"discipline_id": string | null,"id": string,"joined_at": string | null,"left_at": string | null,"organization_id": string | null,"project_id": string,"role_id": string,"tenant_id": string,"updated_at": string,"updated_by": string | null,"user_id": string,"version": number
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"discipline_id"?: string | null,"id"?: string,"joined_at"?: string | null,"left_at"?: string | null,"organization_id"?: string | null,"project_id": string,"role_id": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null,"user_id": string,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"discipline_id"?: string | null,"id"?: string,"joined_at"?: string | null,"left_at"?: string | null,"organization_id"?: string | null,"project_id"?: string,"role_id"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_members_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"project_module_access": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"module": string,"project_id": string,"role_id": string | null,"tenant_id": string,"user_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"module": string,"project_id": string,"role_id"?: string | null,"tenant_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"module"?: string,"project_id"?: string,"role_id"?: string | null,"tenant_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_module_access_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_module_access_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_module_access_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_module_access_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_module_access_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"project_module_restrictions": {
                  Row: {
                    "module": string,"project_id": string,"restricted_at": string,"restricted_by": string | null,"tenant_id": string
                  }
                  Insert: {
                    "module": string,"project_id": string,"restricted_at"?: string,"restricted_by"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "module"?: string,"project_id"?: string,"restricted_at"?: string,"restricted_by"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_module_restrictions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_module_restrictions_restricted_by_fkey"
      columns: ["restricted_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_module_restrictions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"project_org_disciplines": {
                  Row: {
                    "created_at": string,"created_by": string | null,"discipline_id": string,"id": string,"organization_id": string,"project_id": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"discipline_id": string,"id"?: string,"organization_id": string,"project_id": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"discipline_id"?: string,"id"?: string,"organization_id"?: string,"project_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_org_disciplines_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_org_disciplines_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_org_disciplines_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_org_disciplines_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_org_disciplines_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"project_weather": {
                  Row: {
                    "code": number | null,"day": string,"fetched_at": string,"gust": number | null,"precip": number | null,"project_id": string,"tenant_id": string,"tmax": number | null,"tmin": number | null,"wind": number | null
                  }
                  Insert: {
                    "code"?: number | null,"day": string,"fetched_at"?: string,"gust"?: number | null,"precip"?: number | null,"project_id": string,"tenant_id": string,"tmax"?: number | null,"tmin"?: number | null,"wind"?: number | null
                  }
                  Update: {
                    "code"?: number | null,"day"?: string,"fetched_at"?: string,"gust"?: number | null,"precip"?: number | null,"project_id"?: string,"tenant_id"?: string,"tmax"?: number | null,"tmin"?: number | null,"wind"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_weather_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_weather_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "actual_finish": string | null,"actual_start": string | null,"address": string | null,"client_org_id": string | null,"code": string,"cover_file_id": string | null,"created_at": string,"created_by": string | null,"currency": string,"deleted_at": string | null,"fx_rate": number | null,"id": string,"kind": string | null,"manager_user_id": string | null,"modules": (string)[],"name": string,"planned_finish": string | null,"planned_start": string | null,"settings": NonNullable<Json>,"status": string,"tenant_id": string,"timezone": string,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  Insert: {
                    "actual_finish"?: string | null,"actual_start"?: string | null,"address"?: string | null,"client_org_id"?: string | null,"code": string,"cover_file_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"deleted_at"?: string | null,"fx_rate"?: number | null,"id"?: string,"kind"?: string | null,"manager_user_id"?: string | null,"modules"?: (string)[],"name": string,"planned_finish"?: string | null,"planned_start"?: string | null,"settings"?: NonNullable<Json>,"status"?: string,"tenant_id": string,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "actual_finish"?: string | null,"actual_start"?: string | null,"address"?: string | null,"client_org_id"?: string | null,"code"?: string,"cover_file_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"deleted_at"?: string | null,"fx_rate"?: number | null,"id"?: string,"kind"?: string | null,"manager_user_id"?: string | null,"modules"?: (string)[],"name"?: string,"planned_finish"?: string | null,"planned_start"?: string | null,"settings"?: NonNullable<Json>,"status"?: string,"tenant_id"?: string,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_client_org_id_fkey"
      columns: ["client_org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_cover_file_id_fkey"
      columns: ["cover_file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "projects_cover_file_id_fkey"
      columns: ["cover_file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_manager_user_id_fkey"
      columns: ["manager_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"p256dh": string,"tenant_id": string,"updated_at": string,"user_agent": string | null,"user_id": string
                  }
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string,"tenant_id": string,"updated_at"?: string,"user_agent"?: string | null,"user_id": string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string,"tenant_id"?: string,"updated_at"?: string,"user_agent"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscriptions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "push_subscriptions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"reason_codes": {
                  Row: {
                    "applies_to": (string)[],"category": string,"code": string,"created_at": string,"id": string,"is_active": boolean,"name": string,"tenant_id": string
                  }
                  Insert: {
                    "applies_to"?: (string)[],"category": string,"code": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"tenant_id": string
                  }
                  Update: {
                    "applies_to"?: (string)[],"category"?: string,"code"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reason_codes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"rfq_lines": {
                  Row: {
                    "id": string,"name": string,"position": number,"qty": number,"rfq_id": string,"tenant_id": string,"unit": string
                  }
                  Insert: {
                    "id"?: string,"name": string,"position": number,"qty": number,"rfq_id": string,"tenant_id": string,"unit"?: string
                  }
                  Update: {
                    "id"?: string,"name"?: string,"position"?: number,"qty"?: number,"rfq_id"?: string,"tenant_id"?: string,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rfq_lines_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_lines_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"rfq_quote_lines": {
                  Row: {
                    "line_id": string,"quote_id": string,"tenant_id": string,"unit_price": number
                  }
                  Insert: {
                    "line_id": string,"quote_id": string,"tenant_id": string,"unit_price": number
                  }
                  Update: {
                    "line_id"?: string,"quote_id"?: string,"tenant_id"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "rfq_quote_lines_line_id_fkey"
      columns: ["line_id"]
isOneToOne: false
      referencedRelation: "rfq_lines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_quote_lines_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "rfq_quotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_quote_lines_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"rfq_quotes": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency": string,"delivery_days": number | null,"id": string,"note": string,"rfq_id": string,"status": string,"supplier": string,"supplier_id": string | null,"tenant_id": string,"terms": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency": string,"delivery_days"?: number | null,"id"?: string,"note"?: string,"rfq_id": string,"status"?: string,"supplier": string,"supplier_id"?: string | null,"tenant_id": string,"terms"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string,"delivery_days"?: number | null,"id"?: string,"note"?: string,"rfq_id"?: string,"status"?: string,"supplier"?: string,"supplier_id"?: string | null,"tenant_id"?: string,"terms"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rfq_quotes_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_quotes_rfq_id_fkey"
      columns: ["rfq_id"]
isOneToOne: false
      referencedRelation: "rfqs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_quotes_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfq_quotes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"rfqs": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"due_date": string | null,"id": string,"key": string,"note": string,"number": number,"project_id": string,"request_id": string | null,"status": string,"tenant_id": string,"title": string,"updated_at": string,"winner_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"due_date"?: string | null,"id"?: string,"key": string,"note"?: string,"number": number,"project_id": string,"request_id"?: string | null,"status"?: string,"tenant_id": string,"title": string,"updated_at"?: string,"winner_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"due_date"?: string | null,"id"?: string,"key"?: string,"note"?: string,"number"?: number,"project_id"?: string,"request_id"?: string | null,"status"?: string,"tenant_id"?: string,"title"?: string,"updated_at"?: string,"winner_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rfqs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "material_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rfqs_winner_fk"
      columns: ["winner_id"]
isOneToOne: false
      referencedRelation: "rfq_quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"risks": {
                  Row: {
                    "category": string,"cost_impact": number | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"description": string,"id": string,"impact": number,"key": string,"mitigation": string,"number": number,"owner_id": string | null,"probability": number,"project_id": string,"response": string | null,"review_date": string | null,"schedule_impact_days": number | null,"score": number | null,"status": string,"tenant_id": string,"title": string,"trigger_text": string,"updated_at": string
                  }
                  Insert: {
                    "category"?: string,"cost_impact"?: number | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"description"?: string,"id"?: string,"impact": number,"key": string,"mitigation"?: string,"number": number,"owner_id"?: string | null,"probability": number,"project_id": string,"response"?: string | null,"review_date"?: string | null,"schedule_impact_days"?: number | null,"score"?: never,"status"?: string,"tenant_id": string,"title": string,"trigger_text"?: string,"updated_at"?: string
                  }
                  Update: {
                    "category"?: string,"cost_impact"?: number | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"description"?: string,"id"?: string,"impact"?: number,"key"?: string,"mitigation"?: string,"number"?: number,"owner_id"?: string | null,"probability"?: number,"project_id"?: string,"response"?: string | null,"review_date"?: string | null,"schedule_impact_days"?: number | null,"score"?: never,"status"?: string,"tenant_id"?: string,"title"?: string,"trigger_text"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "risks_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "risks_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "risks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "risks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"role_permissions": {
                  Row: {
                    "permission": string,"role_id": string,"tenant_id": string
                  }
                  Insert: {
                    "permission": string,"role_id": string,"tenant_id": string
                  }
                  Update: {
                    "permission"?: string,"role_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_permission_fkey"
      columns: ["permission"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "role_permissions_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "role_permissions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"roles": {
                  Row: {
                    "code": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"is_system": boolean,"name": string,"scope": string,"tenant_id": string,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  Insert: {
                    "code": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"is_system"?: boolean,"name": string,"scope": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"is_system"?: boolean,"name"?: string,"scope"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "roles_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"room_ffe": {
                  Row: {
                    "id": string,"item_id": string,"location_id": string,"project_id": string,"qty": number,"source": string,"status": string,"status_at": string | null,"status_by": string | null,"tenant_id": string
                  }
                  Insert: {
                    "id"?: string,"item_id": string,"location_id": string,"project_id": string,"qty": number,"source"?: string,"status"?: string,"status_at"?: string | null,"status_by"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "id"?: string,"item_id"?: string,"location_id"?: string,"project_id"?: string,"qty"?: number,"source"?: string,"status"?: string,"status_at"?: string | null,"status_by"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "room_ffe_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "ffe_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_ffe_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_ffe_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_ffe_status_by_fkey"
      columns: ["status_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_ffe_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"room_specs": {
                  Row: {
                    "area": number | null,"location_id": string,"project_id": string,"specs": string | null,"tenant_id": string,"type_id": string | null,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "area"?: number | null,"location_id": string,"project_id": string,"specs"?: string | null,"tenant_id": string,"type_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "area"?: number | null,"location_id"?: string,"project_id"?: string,"specs"?: string | null,"tenant_id"?: string,"type_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "room_specs_location_id_fkey"
      columns: ["location_id"]
isOneToOne: true
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_specs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_specs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_specs_type_id_fkey"
      columns: ["type_id"]
isOneToOne: false
      referencedRelation: "room_types"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_specs_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"room_type_items": {
                  Row: {
                    "item_id": string,"project_id": string,"qty": number,"tenant_id": string,"type_id": string
                  }
                  Insert: {
                    "item_id": string,"project_id": string,"qty": number,"tenant_id": string,"type_id": string
                  }
                  Update: {
                    "item_id"?: string,"project_id"?: string,"qty"?: number,"tenant_id"?: string,"type_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "room_type_items_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "ffe_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_type_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_type_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_type_items_type_id_fkey"
      columns: ["type_id"]
isOneToOne: false
      referencedRelation: "room_types"
      referencedColumns: ["id"]
    }
                  ]
                },"room_types": {
                  Row: {
                    "area": number | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"name": string,"project_id": string,"specs": string | null,"tenant_id": string
                  }
                  Insert: {
                    "area"?: number | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"name": string,"project_id": string,"specs"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "area"?: number | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"name"?: string,"project_id"?: string,"specs"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "room_types_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_types_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "room_types_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"schedule_activities": {
                  Row: {
                    "actual_finish": string | null,"actual_start": string | null,"calc_at": string | null,"constraint_date": string | null,"constraint_type": string,"contractor_org_id": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"discipline_id": string | null,"duration_days": number,"external_ref": string | null,"finish_date": string | null,"free_float": number | null,"id": string,"is_critical": boolean,"kind": string,"late_finish": string | null,"late_start": string | null,"location_id": string | null,"name": string,"parent_id": string | null,"percent_complete": number,"plan_quantity": number | null,"progress_method": string,"project_id": string,"quantity_unit": string | null,"responsible_id": string | null,"sort": number,"start_date": string | null,"tenant_id": string,"total_float": number | null,"updated_at": string
                  }
                  Insert: {
                    "actual_finish"?: string | null,"actual_start"?: string | null,"calc_at"?: string | null,"constraint_date"?: string | null,"constraint_type"?: string,"contractor_org_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"discipline_id"?: string | null,"duration_days"?: number,"external_ref"?: string | null,"finish_date"?: string | null,"free_float"?: number | null,"id"?: string,"is_critical"?: boolean,"kind"?: string,"late_finish"?: string | null,"late_start"?: string | null,"location_id"?: string | null,"name": string,"parent_id"?: string | null,"percent_complete"?: number,"plan_quantity"?: number | null,"progress_method"?: string,"project_id": string,"quantity_unit"?: string | null,"responsible_id"?: string | null,"sort"?: number,"start_date"?: string | null,"tenant_id": string,"total_float"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "actual_finish"?: string | null,"actual_start"?: string | null,"calc_at"?: string | null,"constraint_date"?: string | null,"constraint_type"?: string,"contractor_org_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"discipline_id"?: string | null,"duration_days"?: number,"external_ref"?: string | null,"finish_date"?: string | null,"free_float"?: number | null,"id"?: string,"is_critical"?: boolean,"kind"?: string,"late_finish"?: string | null,"late_start"?: string | null,"location_id"?: string | null,"name"?: string,"parent_id"?: string | null,"percent_complete"?: number,"plan_quantity"?: number | null,"progress_method"?: string,"project_id"?: string,"quantity_unit"?: string | null,"responsible_id"?: string | null,"sort"?: number,"start_date"?: string | null,"tenant_id"?: string,"total_float"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_activities_contractor_org_id_fkey"
      columns: ["contractor_org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_activities_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_activities_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_activities_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_activities_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_activities_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_activities_responsible_id_fkey"
      columns: ["responsible_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_activities_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"schedule_baseline_activities": {
                  Row: {
                    "activity_id": string,"baseline_id": string,"finish_date": string | null,"project_id": string,"start_date": string | null,"tenant_id": string
                  }
                  Insert: {
                    "activity_id": string,"baseline_id": string,"finish_date"?: string | null,"project_id": string,"start_date"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "activity_id"?: string,"baseline_id"?: string,"finish_date"?: string | null,"project_id"?: string,"start_date"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_baseline_activities_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_baseline_activities_baseline_id_fkey"
      columns: ["baseline_id"]
isOneToOne: false
      referencedRelation: "schedule_baselines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_baseline_activities_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_baseline_activities_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"schedule_baselines": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"number": number,"project_id": string,"reason": string | null,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"number": number,"project_id": string,"reason"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"number"?: number,"project_id"?: string,"reason"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_baselines_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_baselines_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_baselines_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"schedule_links": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"lag_days": number,"predecessor_id": string,"project_id": string,"successor_id": string,"tenant_id": string,"type": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"lag_days"?: number,"predecessor_id": string,"project_id": string,"successor_id": string,"tenant_id": string,"type"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"lag_days"?: number,"predecessor_id"?: string,"project_id"?: string,"successor_id"?: string,"tenant_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_links_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_links_predecessor_id_fkey"
      columns: ["predecessor_id"]
isOneToOne: false
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_links_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_links_successor_id_fkey"
      columns: ["successor_id"]
isOneToOne: false
      referencedRelation: "schedule_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_links_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"signal_settings": {
                  Row: {
                    "enabled": boolean,"params": NonNullable<Json>,"project_id": string,"rule": string,"tenant_id": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "enabled"?: boolean,"params"?: NonNullable<Json>,"project_id": string,"rule": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "enabled"?: boolean,"params"?: NonNullable<Json>,"project_id"?: string,"rule"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "signal_settings_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signal_settings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signal_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"signals": {
                  Row: {
                    "actions": NonNullable<Json>,"agenda_meeting_id": string | null,"assignee_id": string | null,"auto_resolved": boolean,"dedup_key": string,"dismiss_reason": string | null,"dismiss_until": string | null,"dismissed_at": string | null,"dismissed_by": string | null,"evidence": NonNullable<Json>,"facts": NonNullable<Json>,"first_seen_at": string,"id": string,"last_seen_at": string,"project_id": string,"resolved_at": string | null,"rule": string,"rule_text": string | null,"severity": string,"severity_history": NonNullable<Json>,"status": string,"task_id": string | null,"tenant_id": string,"title": string,"useful": boolean | null
                  }
                  Insert: {
                    "actions"?: NonNullable<Json>,"agenda_meeting_id"?: string | null,"assignee_id"?: string | null,"auto_resolved"?: boolean,"dedup_key": string,"dismiss_reason"?: string | null,"dismiss_until"?: string | null,"dismissed_at"?: string | null,"dismissed_by"?: string | null,"evidence"?: NonNullable<Json>,"facts"?: NonNullable<Json>,"first_seen_at"?: string,"id"?: string,"last_seen_at"?: string,"project_id": string,"resolved_at"?: string | null,"rule": string,"rule_text"?: string | null,"severity": string,"severity_history"?: NonNullable<Json>,"status"?: string,"task_id"?: string | null,"tenant_id": string,"title": string,"useful"?: boolean | null
                  }
                  Update: {
                    "actions"?: NonNullable<Json>,"agenda_meeting_id"?: string | null,"assignee_id"?: string | null,"auto_resolved"?: boolean,"dedup_key"?: string,"dismiss_reason"?: string | null,"dismiss_until"?: string | null,"dismissed_at"?: string | null,"dismissed_by"?: string | null,"evidence"?: NonNullable<Json>,"facts"?: NonNullable<Json>,"first_seen_at"?: string,"id"?: string,"last_seen_at"?: string,"project_id"?: string,"resolved_at"?: string | null,"rule"?: string,"rule_text"?: string | null,"severity"?: string,"severity_history"?: NonNullable<Json>,"status"?: string,"task_id"?: string | null,"tenant_id"?: string,"title"?: string,"useful"?: boolean | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "signals_agenda_meeting_id_fkey"
      columns: ["agenda_meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signals_agenda_meeting_id_fkey"
      columns: ["agenda_meeting_id"]
isOneToOne: false
      referencedRelation: "meetings_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signals_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signals_dismissed_by_fkey"
      columns: ["dismissed_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signals_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signals_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signals_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"signature_request_signers": {
                  Row: {
                    "decided_at": string | null,"decline_reason": string | null,"position": number,"request_id": string,"signature_id": string | null,"status": string,"user_id": string
                  }
                  Insert: {
                    "decided_at"?: string | null,"decline_reason"?: string | null,"position": number,"request_id": string,"signature_id"?: string | null,"status"?: string,"user_id": string
                  }
                  Update: {
                    "decided_at"?: string | null,"decline_reason"?: string | null,"position"?: number,"request_id"?: string,"signature_id"?: string | null,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "signature_request_signers_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "signature_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_request_signers_signature_fkey"
      columns: ["signature_id"]
isOneToOne: false
      referencedRelation: "signatures"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_request_signers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"signature_requests": {
                  Row: {
                    "base_version_id": string,"created_at": string,"created_by": string,"current_file_id": string,"document_id": string,"finished_at": string | null,"id": string,"message": string | null,"project_id": string,"result_version_id": string | null,"sequential": boolean,"status": string,"tenant_id": string
                  }
                  Insert: {
                    "base_version_id": string,"created_at"?: string,"created_by": string,"current_file_id": string,"document_id": string,"finished_at"?: string | null,"id"?: string,"message"?: string | null,"project_id": string,"result_version_id"?: string | null,"sequential"?: boolean,"status"?: string,"tenant_id": string
                  }
                  Update: {
                    "base_version_id"?: string,"created_at"?: string,"created_by"?: string,"current_file_id"?: string,"document_id"?: string,"finished_at"?: string | null,"id"?: string,"message"?: string | null,"project_id"?: string,"result_version_id"?: string | null,"sequential"?: boolean,"status"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "signature_requests_base_version_id_fkey"
      columns: ["base_version_id"]
isOneToOne: false
      referencedRelation: "document_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_requests_base_version_id_fkey"
      columns: ["base_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["current_version_id"]
    },{
      foreignKeyName: "signature_requests_base_version_id_fkey"
      columns: ["base_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["latest_version_id"]
    },{
      foreignKeyName: "signature_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_requests_current_file_id_fkey"
      columns: ["current_file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "signature_requests_current_file_id_fkey"
      columns: ["current_file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_requests_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_requests_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_requests_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_requests_result_version_id_fkey"
      columns: ["result_version_id"]
isOneToOne: false
      referencedRelation: "document_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_requests_result_version_id_fkey"
      columns: ["result_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["current_version_id"]
    },{
      foreignKeyName: "signature_requests_result_version_id_fkey"
      columns: ["result_version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["latest_version_id"]
    },{
      foreignKeyName: "signature_requests_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"signatures": {
                  Row: {
                    "batch_id": string,"document_id": string | null,"file_id": string | null,"file_name": string,"file_path": string | null,"hash_after": string,"hash_before": string,"id": string,"page": number | null,"project_id": string | null,"request_id": string | null,"signed_at": string,"signer_id": string,"signer_name": string,"source": string,"tenant_id": string,"user_agent": string | null
                  }
                  Insert: {
                    "batch_id": string,"document_id"?: string | null,"file_id"?: string | null,"file_name": string,"file_path"?: string | null,"hash_after": string,"hash_before": string,"id": string,"page"?: number | null,"project_id"?: string | null,"request_id"?: string | null,"signed_at"?: string,"signer_id": string,"signer_name": string,"source": string,"tenant_id": string,"user_agent"?: string | null
                  }
                  Update: {
                    "batch_id"?: string,"document_id"?: string | null,"file_id"?: string | null,"file_name"?: string,"file_path"?: string | null,"hash_after"?: string,"hash_before"?: string,"id"?: string,"page"?: number | null,"project_id"?: string | null,"request_id"?: string | null,"signed_at"?: string,"signer_id"?: string,"signer_name"?: string,"source"?: string,"tenant_id"?: string,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "signatures_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signatures_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signatures_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["thumb_file_id"]
    },{
      foreignKeyName: "signatures_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signatures_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signatures_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "signature_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signatures_signer_id_fkey"
      columns: ["signer_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signatures_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"site_walk_results": {
                  Row: {
                    "comment": string | null,"qty": number | null,"reason_code": string | null,"result": string,"tenant_id": string,"updated_at": string,"walk_id": string,"work_item_id": string
                  }
                  Insert: {
                    "comment"?: string | null,"qty"?: number | null,"reason_code"?: string | null,"result": string,"tenant_id": string,"updated_at"?: string,"walk_id": string,"work_item_id": string
                  }
                  Update: {
                    "comment"?: string | null,"qty"?: number | null,"reason_code"?: string | null,"result"?: string,"tenant_id"?: string,"updated_at"?: string,"walk_id"?: string,"work_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_walk_results_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "site_walk_results_walk_id_fkey"
      columns: ["walk_id"]
isOneToOne: false
      referencedRelation: "site_walks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "site_walk_results_work_item_id_fkey"
      columns: ["work_item_id"]
isOneToOne: false
      referencedRelation: "work_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "site_walk_results_work_item_id_fkey"
      columns: ["work_item_id"]
isOneToOne: false
      referencedRelation: "work_items_progress"
      referencedColumns: ["id"]
    }
                  ]
                },"site_walks": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"author_id": string,"id": string,"kind": string,"location_id": string,"location_path": string,"project_id": string,"started_at": string,"status": string,"submitted_at": string | null,"tenant_id": string
                  }
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"author_id": string,"id"?: string,"kind"?: string,"location_id": string,"location_path": string,"project_id": string,"started_at"?: string,"status"?: string,"submitted_at"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"author_id"?: string,"id"?: string,"kind"?: string,"location_id"?: string,"location_path"?: string,"project_id"?: string,"started_at"?: string,"status"?: string,"submitted_at"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_walks_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "site_walks_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "site_walks_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "site_walks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "site_walks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"snapshots": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"kind": string,"metrics": NonNullable<Json>,"note": string | null,"project_id": string,"status_date": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"metrics": NonNullable<Json>,"note"?: string | null,"project_id": string,"status_date": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"metrics"?: NonNullable<Json>,"note"?: string | null,"project_id"?: string,"status_date"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "snapshots_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "snapshots_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "snapshots_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"sprint_tasks": {
                  Row: {
                    "added_late": boolean,"created_at": string,"created_by": string | null,"id": string,"project_id": string,"reason": string | null,"reason_note": string | null,"result": string | null,"sprint_id": string,"task_id": string,"tenant_id": string
                  }
                  Insert: {
                    "added_late"?: boolean,"created_at"?: string,"created_by"?: string | null,"id"?: string,"project_id": string,"reason"?: string | null,"reason_note"?: string | null,"result"?: string | null,"sprint_id": string,"task_id": string,"tenant_id": string
                  }
                  Update: {
                    "added_late"?: boolean,"created_at"?: string,"created_by"?: string | null,"id"?: string,"project_id"?: string,"reason"?: string | null,"reason_note"?: string | null,"result"?: string | null,"sprint_id"?: string,"task_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sprint_tasks_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sprint_tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sprint_tasks_sprint_id_fkey"
      columns: ["sprint_id"]
isOneToOne: false
      referencedRelation: "design_sprints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sprint_tasks_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sprint_tasks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_departments": {
                  Row: {
                    "created_at": string,"description": string,"head_user_id": string | null,"id": string,"is_assistant": boolean,"name": string,"outsourced_to": string | null,"parent_id": string | null,"position": number,"steps": (string)[],"tenant_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"description"?: string,"head_user_id"?: string | null,"id"?: string,"is_assistant"?: boolean,"name": string,"outsourced_to"?: string | null,"parent_id"?: string | null,"position"?: number,"steps"?: (string)[],"tenant_id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"head_user_id"?: string | null,"id"?: string,"is_assistant"?: boolean,"name"?: string,"outsourced_to"?: string | null,"parent_id"?: string | null,"position"?: number,"steps"?: (string)[],"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_departments_head_user_id_fkey"
      columns: ["head_user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_departments_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "staff_departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_departments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_experience": {
                  Row: {
                    "company": string,"created_at": string,"ended_on": string | null,"id": string,"note": string,"role": string,"started_on": string | null,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "company": string,"created_at"?: string,"ended_on"?: string | null,"id"?: string,"note"?: string,"role"?: string,"started_on"?: string | null,"tenant_id"?: string,"user_id": string
                  }
                  Update: {
                    "company"?: string,"created_at"?: string,"ended_on"?: string | null,"id"?: string,"note"?: string,"role"?: string,"started_on"?: string | null,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_experience_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_experience_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_notes": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"done_at": string | null,"id": string,"kind": string,"remind_on": string | null,"reminded_at": string | null,"tenant_id": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "author_id"?: string,"body": string,"created_at"?: string,"done_at"?: string | null,"id"?: string,"kind"?: string,"remind_on"?: string | null,"reminded_at"?: string | null,"tenant_id"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"done_at"?: string | null,"id"?: string,"kind"?: string,"remind_on"?: string | null,"reminded_at"?: string | null,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_notes_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_notes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_notes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_positions": {
                  Row: {
                    "created_at": string,"department_id": string,"headcount": number,"id": string,"person_name": string,"position": number,"role_id": string,"tenant_id": string,"title": string,"updated_at": string,"user_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"department_id": string,"headcount"?: number,"id"?: string,"person_name"?: string,"position"?: number,"role_id": string,"tenant_id"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"department_id"?: string,"headcount"?: number,"id"?: string,"person_name"?: string,"position"?: number,"role_id"?: string,"tenant_id"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_positions_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "staff_departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_positions_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_positions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_positions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_profiles": {
                  Row: {
                    "department_id": string | null,"employment_type": string,"experience_before_months": number | null,"hire_date": string | null,"manager_id": string | null,"next_review_on": string | null,"review_interval_months": number,"review_reminded_for": string | null,"tenant_id": string,"updated_at": string,"updated_by": string | null,"user_id": string
                  }
                  Insert: {
                    "department_id"?: string | null,"employment_type"?: string,"experience_before_months"?: number | null,"hire_date"?: string | null,"manager_id"?: string | null,"next_review_on"?: string | null,"review_interval_months"?: number,"review_reminded_for"?: string | null,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "department_id"?: string | null,"employment_type"?: string,"experience_before_months"?: number | null,"hire_date"?: string | null,"manager_id"?: string | null,"next_review_on"?: string | null,"review_interval_months"?: number,"review_reminded_for"?: string | null,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_profiles_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "staff_departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_profiles_manager_id_fkey"
      columns: ["manager_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_profiles_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_profiles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_review_assessments": {
                  Row: {
                    "goals": string,"manager_text": string,"rating": number | null,"review_id": string,"tenant_id": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "goals"?: string,"manager_text"?: string,"rating"?: number | null,"review_id": string,"tenant_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "goals"?: string,"manager_text"?: string,"rating"?: number | null,"review_id"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_review_assessments_review_id_fkey"
      columns: ["review_id"]
isOneToOne: true
      referencedRelation: "staff_reviews"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_review_assessments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_reviews": {
                  Row: {
                    "created_at": string,"created_by": string | null,"due_on": string,"id": string,"period": string,"reminded_stage": string | null,"reviewer_id": string | null,"self_submitted_at": string | null,"self_text": string,"shared_at": string | null,"status": string,"tenant_id": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"due_on": string,"id"?: string,"period": string,"reminded_stage"?: string | null,"reviewer_id"?: string | null,"self_submitted_at"?: string | null,"self_text"?: string,"shared_at"?: string | null,"status"?: string,"tenant_id"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"due_on"?: string,"id"?: string,"period"?: string,"reminded_stage"?: string | null,"reviewer_id"?: string | null,"self_submitted_at"?: string | null,"self_text"?: string,"shared_at"?: string | null,"status"?: string,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_reviews_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_reviews_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_reviews_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_skill_levels": {
                  Row: {
                    "level": number,"skill_id": string,"tenant_id": string,"updated_at": string,"updated_by": string | null,"user_id": string
                  }
                  Insert: {
                    "level": number,"skill_id": string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "level"?: number,"skill_id"?: string,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_skill_levels_skill_id_fkey"
      columns: ["skill_id"]
isOneToOne: false
      referencedRelation: "staff_skills"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_skill_levels_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_skill_levels_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_skills": {
                  Row: {
                    "category": string,"created_at": string,"id": string,"name": string,"tenant_id": string
                  }
                  Insert: {
                    "category"?: string,"created_at"?: string,"id"?: string,"name": string,"tenant_id"?: string
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"id"?: string,"name"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_skills_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "address": string,"category": string,"contact": string,"country": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"email": string,"id": string,"name": string,"note": string,"phone": string,"status": string,"tax_id": string,"tenant_id": string,"updated_at": string
                  }
                  Insert: {
                    "address"?: string,"category"?: string,"contact"?: string,"country"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string,"id"?: string,"name": string,"note"?: string,"phone"?: string,"status"?: string,"tax_id"?: string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string,"category"?: string,"contact"?: string,"country"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string,"id"?: string,"name"?: string,"note"?: string,"phone"?: string,"status"?: string,"tax_id"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "suppliers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"task_escalations": {
                  Row: {
                    "fired_at": string,"step": number,"task_id": string
                  }
                  Insert: {
                    "fired_at"?: string,"step": number,"task_id": string
                  }
                  Update: {
                    "fired_at"?: string,"step"?: number,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_escalations_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"task_pins": {
                  Row: {
                    "created_at": string,"created_by": string | null,"doc_no": number,"document_id": string,"id": string,"page": number,"project_id": string,"task_id": string,"tenant_id": string,"updated_at": string,"version_id": string | null,"x": number,"x2": number | null,"y": number,"y2": number | null
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"doc_no": number,"document_id": string,"id"?: string,"page"?: number,"project_id": string,"task_id": string,"tenant_id": string,"updated_at"?: string,"version_id"?: string | null,"x": number,"x2"?: number | null,"y": number,"y2"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"doc_no"?: number,"document_id"?: string,"id"?: string,"page"?: number,"project_id"?: string,"task_id"?: string,"tenant_id"?: string,"updated_at"?: string,"version_id"?: string | null,"x"?: number,"x2"?: number | null,"y"?: number,"y2"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_pins_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_pins_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_pins_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_pins_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_pins_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_pins_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_pins_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "document_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_pins_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["current_version_id"]
    },{
      foreignKeyName: "task_pins_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "documents_overview"
      referencedColumns: ["latest_version_id"]
    }
                  ]
                },"task_templates": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"description": string | null,"id": string,"items": NonNullable<Json>,"name": string,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"items": NonNullable<Json>,"name": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"items"?: NonNullable<Json>,"name"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_templates_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_templates_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "actual_start": string | null,"assignee_id": string | null,"blocked_comment": string | null,"blocked_reason_code": string | null,"closed_at": string | null,"completed_at": string | null,"created_at": string,"created_by": string | null,"custom": NonNullable<Json>,"deleted_at": string | null,"description": Json | null,"discipline_id": string | null,"due_date": string | null,"estimate_hours": number | null,"id": string,"key": string,"location_id": string | null,"location_path": string | null,"meeting_id": string | null,"need_by_date": string | null,"number": number,"organization_id": string | null,"parent_id": string | null,"planned_start": string | null,"priority": string,"priority_rank": number | null,"project_id": string,"reporter_id": string,"source_id": string | null,"source_type": string | null,"spent_hours": number | null,"status_category": string,"status_id": string,"status_rank": number | null,"tags": (string)[],"tenant_id": string,"title": string,"type": string,"updated_at": string,"updated_by": string | null,"version": number,"visibility": string,"workflow_id": string
                  }
                  Insert: {
                    "actual_start"?: string | null,"assignee_id"?: string | null,"blocked_comment"?: string | null,"blocked_reason_code"?: string | null,"closed_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"custom"?: NonNullable<Json>,"deleted_at"?: string | null,"description"?: Json | null,"discipline_id"?: string | null,"due_date"?: string | null,"estimate_hours"?: number | null,"id"?: string,"key": string,"location_id"?: string | null,"location_path"?: string | null,"meeting_id"?: string | null,"need_by_date"?: string | null,"number": number,"organization_id"?: string | null,"parent_id"?: string | null,"planned_start"?: string | null,"priority"?: string,"priority_rank"?: never,"project_id": string,"reporter_id": string,"source_id"?: string | null,"source_type"?: string | null,"spent_hours"?: number | null,"status_category": string,"status_id": string,"status_rank"?: never,"tags"?: (string)[],"tenant_id": string,"title": string,"type": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"visibility"?: string,"workflow_id": string
                  }
                  Update: {
                    "actual_start"?: string | null,"assignee_id"?: string | null,"blocked_comment"?: string | null,"blocked_reason_code"?: string | null,"closed_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"custom"?: NonNullable<Json>,"deleted_at"?: string | null,"description"?: Json | null,"discipline_id"?: string | null,"due_date"?: string | null,"estimate_hours"?: number | null,"id"?: string,"key"?: string,"location_id"?: string | null,"location_path"?: string | null,"meeting_id"?: string | null,"need_by_date"?: string | null,"number"?: number,"organization_id"?: string | null,"parent_id"?: string | null,"planned_start"?: string | null,"priority"?: string,"priority_rank"?: never,"project_id"?: string,"reporter_id"?: string,"source_id"?: string | null,"source_type"?: string | null,"spent_hours"?: number | null,"status_category"?: string,"status_id"?: string,"status_rank"?: never,"tags"?: (string)[],"tenant_id"?: string,"title"?: string,"type"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"visibility"?: string,"workflow_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_status_id_fkey"
      columns: ["status_id"]
isOneToOne: false
      referencedRelation: "workflow_statuses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_tenant_id_blocked_reason_code_fkey"
      columns: ["tenant_id","blocked_reason_code"]
isOneToOne: false
      referencedRelation: "reason_codes"
      referencedColumns: ["tenant_id","code"]
    },{
      foreignKeyName: "tasks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_workflow_id_fkey"
      columns: ["workflow_id"]
isOneToOne: false
      referencedRelation: "workflows"
      referencedColumns: ["id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"settings": NonNullable<Json>,"slug": string,"status": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"settings"?: NonNullable<Json>,"slug": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"settings"?: NonNullable<Json>,"slug"?: string,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_birthdays": {
                  Row: {
                    "announced_for": string | null,"birth_date": string,"reminded_for": string | null,"show_year": boolean,"tenant_id": string,"updated_at": string,"updated_by": string | null,"user_id": string
                  }
                  Insert: {
                    "announced_for"?: string | null,"birth_date": string,"reminded_for"?: string | null,"show_year"?: boolean,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "announced_for"?: string | null,"birth_date"?: string,"reminded_for"?: string | null,"show_year"?: boolean,"tenant_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_birthdays_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_birthdays_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_notification_settings": {
                  Row: {
                    "app_badge": boolean,"digest_hour": number,"digest_sent_through": string,"quiet_enabled": boolean,"quiet_end": string,"quiet_start": string,"tenant_id": string,"timezone": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "app_badge"?: boolean,"digest_hour"?: number,"digest_sent_through"?: string,"quiet_enabled"?: boolean,"quiet_end"?: string,"quiet_start"?: string,"tenant_id": string,"timezone"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "app_badge"?: boolean,"digest_hour"?: number,"digest_sent_through"?: string,"quiet_enabled"?: boolean,"quiet_end"?: string,"quiet_start"?: string,"tenant_id"?: string,"timezone"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_notification_settings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_notification_settings_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_presence": {
                  Row: {
                    "seen_at": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "seen_at"?: string,"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "seen_at"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_presence_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_presence_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_signatures": {
                  Row: {
                    "created_at": string,"id": string,"image": string,"tenant_id": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"image": string,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"image"?: string,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_signatures_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_signatures_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"user_tenant_roles": {
                  Row: {
                    "role_id": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "role_id": string,"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "role_id"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_tenant_roles_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_tenant_roles_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_tenant_roles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"users": {
                  Row: {
                    "avatar_path": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"email": string,"full_name": string,"id": string,"is_external": boolean,"job_title": string | null,"last_login_at": string | null,"locale": string,"organization_id": string | null,"phone": string | null,"settings": NonNullable<Json>,"status": string,"tenant_id": string,"timezone": string,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  Insert: {
                    "avatar_path"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email": string,"full_name": string,"id": string,"is_external"?: boolean,"job_title"?: string | null,"last_login_at"?: string | null,"locale"?: string,"organization_id"?: string | null,"phone"?: string | null,"settings"?: NonNullable<Json>,"status"?: string,"tenant_id": string,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "avatar_path"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string,"full_name"?: string,"id"?: string,"is_external"?: boolean,"job_title"?: string | null,"last_login_at"?: string | null,"locale"?: string,"organization_id"?: string | null,"phone"?: string | null,"settings"?: NonNullable<Json>,"status"?: string,"tenant_id"?: string,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "users_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "users_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"watchers": {
                  Row: {
                    "created_at": string,"entity_id": string,"entity_type": string,"muted": boolean,"project_id": string,"reason": string,"tenant_id": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"entity_id": string,"entity_type": string,"muted"?: boolean,"project_id": string,"reason"?: string,"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"entity_id"?: string,"entity_type"?: string,"muted"?: boolean,"project_id"?: string,"reason"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "watchers_entity_type_fkey"
      columns: ["entity_type"]
isOneToOne: false
      referencedRelation: "entity_types"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "watchers_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "watchers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "watchers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"work_checks": {
                  Row: {
                    "checked_at": string,"checked_by": string,"delta": number | null,"id": string,"independent": boolean,"observed_qty": number,"project_id": string,"reported_qty": number,"resolution": string | null,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"tenant_id": string,"verdict": string,"walk_id": string,"work_item_id": string
                  }
                  Insert: {
                    "checked_at"?: string,"checked_by": string,"delta"?: never,"id"?: string,"independent": boolean,"observed_qty": number,"project_id": string,"reported_qty": number,"resolution"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"tenant_id": string,"verdict": string,"walk_id": string,"work_item_id": string
                  }
                  Update: {
                    "checked_at"?: string,"checked_by"?: string,"delta"?: never,"id"?: string,"independent"?: boolean,"observed_qty"?: number,"project_id"?: string,"reported_qty"?: number,"resolution"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"tenant_id"?: string,"verdict"?: string,"walk_id"?: string,"work_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_checks_checked_by_fkey"
      columns: ["checked_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_checks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_checks_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_checks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_checks_walk_id_fkey"
      columns: ["walk_id"]
isOneToOne: false
      referencedRelation: "site_walks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_checks_work_item_id_fkey"
      columns: ["work_item_id"]
isOneToOne: false
      referencedRelation: "work_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_checks_work_item_id_fkey"
      columns: ["work_item_id"]
isOneToOne: false
      referencedRelation: "work_items_progress"
      referencedColumns: ["id"]
    }
                  ]
                },"work_items": {
                  Row: {
                    "activity_id": string | null,"contractor_org_id": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"discipline_id": string | null,"id": string,"location_id": string,"location_path": string,"name": string,"planned_finish": string | null,"planned_qty": number,"planned_start": string | null,"project_id": string,"status": string,"tenant_id": string,"unit": string,"updated_at": string,"updated_by": string | null,"version": number,"weight": number | null
                  }
                  Insert: {
                    "activity_id"?: string | null,"contractor_org_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"discipline_id"?: string | null,"id"?: string,"location_id": string,"location_path": string,"name": string,"planned_finish"?: string | null,"planned_qty": number,"planned_start"?: string | null,"project_id": string,"status"?: string,"tenant_id": string,"unit": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"weight"?: number | null
                  }
                  Update: {
                    "activity_id"?: string | null,"contractor_org_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"discipline_id"?: string | null,"id"?: string,"location_id"?: string,"location_path"?: string,"name"?: string,"planned_finish"?: string | null,"planned_qty"?: number,"planned_start"?: string | null,"project_id"?: string,"status"?: string,"tenant_id"?: string,"unit"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"weight"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_items_contractor_org_id_fkey"
      columns: ["contractor_org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_items_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_items_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"work_progress": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"check_id": string | null,"created_at": string,"entry_date": string,"id": string,"kind": string,"project_id": string,"qty": number,"reported_by": string,"tenant_id": string,"walk_id": string | null,"work_item_id": string
                  }
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"check_id"?: string | null,"created_at"?: string,"entry_date"?: string,"id"?: string,"kind"?: string,"project_id": string,"qty": number,"reported_by": string,"tenant_id": string,"walk_id"?: string | null,"work_item_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"check_id"?: string | null,"created_at"?: string,"entry_date"?: string,"id"?: string,"kind"?: string,"project_id"?: string,"qty"?: number,"reported_by"?: string,"tenant_id"?: string,"walk_id"?: string | null,"work_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_progress_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_progress_check_fk"
      columns: ["check_id"]
isOneToOne: false
      referencedRelation: "work_checks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_progress_check_fk"
      columns: ["check_id"]
isOneToOne: false
      referencedRelation: "work_items_progress"
      referencedColumns: ["check_id"]
    },{
      foreignKeyName: "work_progress_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_progress_reported_by_fkey"
      columns: ["reported_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_progress_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_progress_walk_id_fkey"
      columns: ["walk_id"]
isOneToOne: false
      referencedRelation: "site_walks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_progress_work_item_id_fkey"
      columns: ["work_item_id"]
isOneToOne: false
      referencedRelation: "work_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_progress_work_item_id_fkey"
      columns: ["work_item_id"]
isOneToOne: false
      referencedRelation: "work_items_progress"
      referencedColumns: ["id"]
    }
                  ]
                },"workflow_statuses": {
                  Row: {
                    "category": string,"code": string,"color": string | null,"id": string,"name": string,"sort": number,"tenant_id": string,"workflow_id": string
                  }
                  Insert: {
                    "category": string,"code": string,"color"?: string | null,"id"?: string,"name": string,"sort": number,"tenant_id": string,"workflow_id": string
                  }
                  Update: {
                    "category"?: string,"code"?: string,"color"?: string | null,"id"?: string,"name"?: string,"sort"?: number,"tenant_id"?: string,"workflow_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflow_statuses_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_statuses_workflow_id_fkey"
      columns: ["workflow_id"]
isOneToOne: false
      referencedRelation: "workflows"
      referencedColumns: ["id"]
    }
                  ]
                },"workflow_transitions": {
                  Row: {
                    "from_status_id": string | null,"id": string,"name": string | null,"required_permission": string | null,"requires_comment": boolean,"requires_reason": boolean,"tenant_id": string,"to_status_id": string,"workflow_id": string
                  }
                  Insert: {
                    "from_status_id"?: string | null,"id"?: string,"name"?: string | null,"required_permission"?: string | null,"requires_comment"?: boolean,"requires_reason"?: boolean,"tenant_id": string,"to_status_id": string,"workflow_id": string
                  }
                  Update: {
                    "from_status_id"?: string | null,"id"?: string,"name"?: string | null,"required_permission"?: string | null,"requires_comment"?: boolean,"requires_reason"?: boolean,"tenant_id"?: string,"to_status_id"?: string,"workflow_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflow_transitions_from_status_id_fkey"
      columns: ["from_status_id"]
isOneToOne: false
      referencedRelation: "workflow_statuses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_transitions_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_transitions_to_status_id_fkey"
      columns: ["to_status_id"]
isOneToOne: false
      referencedRelation: "workflow_statuses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_transitions_workflow_id_fkey"
      columns: ["workflow_id"]
isOneToOne: false
      referencedRelation: "workflows"
      referencedColumns: ["id"]
    }
                  ]
                },"workflows": {
                  Row: {
                    "created_at": string,"entity_type": string,"id": string,"is_default": boolean,"name": string,"subtype": string | null,"tenant_id": string
                  }
                  Insert: {
                    "created_at"?: string,"entity_type": string,"id"?: string,"is_default"?: boolean,"name": string,"subtype"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"entity_type"?: string,"id"?: string,"is_default"?: boolean,"name"?: string,"subtype"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflows_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "documents_overview": {
                  Row: {
                    "ack_pending": boolean | null,"code": string | null,"created_at": string | null,"created_by": string | null,"current_revision": string | null,"current_version_id": string | null,"current_version_no": number | null,"discipline_id": string | null,"doc_type": string | null,"file_mime": string | null,"file_name": string | null,"file_size": number | null,"folder_id": string | null,"has_thumb": boolean | null,"id": string | null,"latest_revision": string | null,"latest_status": string | null,"latest_version_id": string | null,"location_paths": (string)[] | null,"preview_mime": string | null,"preview_name": string | null,"preview_storage_key": string | null,"project_id": string | null,"published_at": string | null,"requires_ack": boolean | null,"storage_key": string | null,"task_links": number | null,"thumb_file_id": string | null,"thumb_source_key": string | null,"thumb_source_mime": string | null,"title": string | null,"updated_at": string | null,"versions": number | null,"visibility": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_folder_id_fkey"
      columns: ["folder_id"]
isOneToOne: false
      referencedRelation: "document_folders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"meetings_overview": {
                  Row: {
                    "actions_count": number | null,"decisions_count": number | null,"duration_min": number | null,"facilitator_id": string | null,"id": string | null,"key": string | null,"number": number | null,"open_actions_count": number | null,"original_at": string | null,"participants_count": number | null,"place": string | null,"present_count": number | null,"project_id": string | null,"published_at": string | null,"scheduled_at": string | null,"series_id": string | null,"status": string | null,"title": string | null,"type": string | null,"visibility": string | null
                  }
                  Insert: {
                           "actions_count"?: never,"decisions_count"?: never,"duration_min"?: number | null,"facilitator_id"?: string | null,"id"?: string | null,"key"?: string | null,"number"?: number | null,"open_actions_count"?: never,"original_at"?: string | null,"participants_count"?: never,"place"?: string | null,"present_count"?: never,"project_id"?: string | null,"published_at"?: string | null,"scheduled_at"?: string | null,"series_id"?: string | null,"status"?: string | null,"title"?: string | null,"type"?: string | null,"visibility"?: string | null
                         }
                        Update: {
                           "actions_count"?: never,"decisions_count"?: never,"duration_min"?: number | null,"facilitator_id"?: string | null,"id"?: string | null,"key"?: string | null,"number"?: number | null,"open_actions_count"?: never,"original_at"?: string | null,"participants_count"?: never,"place"?: string | null,"present_count"?: never,"project_id"?: string | null,"published_at"?: string | null,"scheduled_at"?: string | null,"series_id"?: string | null,"status"?: string | null,"title"?: string | null,"type"?: string | null,"visibility"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "meetings_facilitator_id_fkey"
      columns: ["facilitator_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_series_id_fkey"
      columns: ["series_id"]
isOneToOne: false
      referencedRelation: "meeting_series"
      referencedColumns: ["id"]
    }
                  ]
                },"work_items_progress": {
                  Row: {
                    "activity_id": string | null,"check_id": string | null,"check_independent": boolean | null,"check_reported_qty": number | null,"check_resolution": string | null,"check_verdict": string | null,"checked_at": string | null,"contractor_org_id": string | null,"created_at": string | null,"created_by": string | null,"deleted_at": string | null,"discipline_id": string | null,"done_qty": number | null,"id": string | null,"location_id": string | null,"location_path": string | null,"name": string | null,"observed_qty": number | null,"pending_qty": number | null,"planned_finish": string | null,"planned_qty": number | null,"planned_start": string | null,"project_id": string | null,"status": string | null,"tenant_id": string | null,"unit": string | null,"updated_at": string | null,"updated_by": string | null,"verification": string | null,"verified_qty": number | null,"version": number | null,"weight": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_items_contractor_org_id_fkey"
      columns: ["contractor_org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_items_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_items_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "ack_document":
{ Args: { "p_version": string }; Returns: undefined
                           },
"activate_me":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"add_commitment":
{ Args: { "p_activity": string,"p_location"?: string,"p_note"?: string,"p_org"?: string,"p_period": string,"p_responsible"?: string,"p_title": string }; Returns: string
                           },
"add_document_version":
{ Args: { "p_document": string,"p_file": string,"p_note": string,"p_publish"?: boolean,"p_revision": string }; Returns: string
                           },
"add_meeting_action":
{ Args: { "p_assignee"?: string,"p_due_date"?: string,"p_meeting": string,"p_priority"?: string,"p_title": string }; Returns: {
              "actual_start": string | null,
"assignee_id": string | null,
"blocked_comment": string | null,
"blocked_reason_code": string | null,
"closed_at": string | null,
"completed_at": string | null,
"created_at": string,
"created_by": string | null,
"custom": NonNullable<Json>,
"deleted_at": string | null,
"description": Json | null,
"discipline_id": string | null,
"due_date": string | null,
"estimate_hours": number | null,
"id": string,
"key": string,
"location_id": string | null,
"location_path": string | null,
"meeting_id": string | null,
"need_by_date": string | null,
"number": number,
"organization_id": string | null,
"parent_id": string | null,
"planned_start": string | null,
"priority": string,
"priority_rank": number | null,
"project_id": string,
"reporter_id": string,
"source_id": string | null,
"source_type": string | null,
"spent_hours": number | null,
"status_category": string,
"status_id": string,
"status_rank": number | null,
"tags": (string)[],
"tenant_id": string,
"title": string,
"type": string,
"updated_at": string,
"updated_by": string | null,
"version": number,
"visibility": string,
"workflow_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"add_meeting_recording":
{ Args: { "p_duration"?: number,"p_file": string,"p_meeting": string,"p_session"?: string }; Returns: string
                           },
"add_sprint_tasks":
{ Args: { "p_sprint": string,"p_tasks": (string)[] }; Returns: number
                           },
"allocate_budget":
{ Args: { "p_activities": (string)[],"p_basis"?: string,"p_item": string }; Returns: number
                           },
"app_badge_counts":
{ Args: { "p_users": (string)[] }; Returns: {
              "badge": number,"user_id": string
            }[]
                           },
"apply_room_type":
{ Args: { "p_locations": (string)[],"p_project": string,"p_type": string }; Returns: number
                           },
"apply_task_template":
{ Args: { "p_locations": (string)[],"p_project": string,"p_start": string,"p_template": string }; Returns: number
                           },
"approve_budget_version":
{ Args: { "p_note"?: string,"p_version": string }; Returns: undefined
                           },
"approve_daily_log":
{ Args: { "p_id": string }; Returns: undefined
                           },
"approve_walk":
{ Args: { "p_walk": string }; Returns: {
              "approved_at": string | null,
"approved_by": string | null,
"author_id": string,
"id": string,
"kind": string,
"location_id": string,
"location_path": string,
"project_id": string,
"started_at": string,
"status": string,
"submitted_at": string | null,
"tenant_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "site_walks"
        isOneToOne: true
        isSetofReturn: false
      } },
"birthdays":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_path": string,"birth_day": number,"birth_month": number,"full_name": string,"job_title": string,"next_date": string,"turns": number,"user_id": string
            }[]
                           },
"board_card_copy":
{ Args: { "p_card": string,"p_keep_checklists"?: boolean,"p_keep_labels"?: boolean,"p_keep_members"?: boolean,"p_list": string,"p_position": number,"p_title": string }; Returns: string
                           },
"board_create":
{ Args: { "p_all_staff"?: boolean,"p_background"?: string,"p_kind": string,"p_lists"?: (string)[],"p_project": string,"p_title": string }; Returns: string
                           },
"bootstrap_tenant":
{ Args: { "p_full_name": string,"p_name": string,"p_slug": string }; Returns: string
                           },
"budget_delete_actual":
{ Args: { "p_id": string }; Returns: undefined
                           },
"budget_delete_commitment":
{ Args: { "p_id": string }; Returns: undefined
                           },
"budget_delete_item":
{ Args: { "p_item": string }; Returns: undefined
                           },
"budget_save_actual":
{ Args: { "p_activity"?: string,"p_amount": number,"p_commitment"?: string,"p_counterparty"?: string,"p_currency"?: string,"p_doc_date": string,"p_doc_number": string,"p_doc_type": string,"p_id": string,"p_item": string,"p_note"?: string,"p_project": string }; Returns: string
                           },
"budget_save_commitment":
{ Args: { "p_amount": number,"p_counterparty": string,"p_currency"?: string,"p_doc_number": string,"p_id": string,"p_item": string,"p_note"?: string,"p_project": string,"p_signed_on": string,"p_status"?: string,"p_title": string }; Returns: string
                           },
"budget_upsert_item":
{ Args: { "p_code": string,"p_cost_type"?: string,"p_id": string,"p_name": string,"p_parent": string,"p_project": string,"p_sort"?: number }; Returns: string
                           },
"building_section":
{ Args: { "p_project": string }; Returns: Json
                           },
"cancel_signature_request":
{ Args: { "p_request": string }; Returns: undefined
                           },
"change_assess":
{ Args: { "p_change": string,"p_cost": number,"p_days": number,"p_note"?: string }; Returns: undefined
                           },
"change_save":
{ Args: { "p_description"?: string,"p_id"?: string,"p_project": string,"p_reason"?: string,"p_title": string }; Returns: string
                           },
"change_transition":
{ Args: { "p_change": string,"p_note"?: string,"p_to": string }; Returns: undefined
                           },
"chat_delete":
{ Args: { "p_message": string }; Returns: (string)[]
                           },
"chat_edit":
{ Args: { "p_body": string,"p_message": string }; Returns: undefined
                           },
"chat_group_create":
{ Args: { "p_name": string,"p_users": (string)[] }; Returns: string
                           },
"chat_group_delete":
{ Args: { "p_channel": string }; Returns: undefined
                           },
"chat_group_leave":
{ Args: { "p_channel": string }; Returns: undefined
                           },
"chat_group_update":
{ Args: { "p_channel": string,"p_name": string,"p_users": (string)[] }; Returns: undefined
                           },
"chat_mark_read":
{ Args: { "p_channel": string }; Returns: undefined
                           },
"chat_online":
{ Args: Record<PropertyKey, never>; Returns: {
              "online": boolean,"seen_at": string,"user_id": string
            }[]
                           },
"chat_open":
{ Args: { "p_kind": string,"p_org"?: string,"p_project": string,"p_user"?: string }; Returns: string
                           },
"chat_overview":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"chat_people":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_path": string,"email": string,"full_name": string,"id": string,"is_external": boolean,"job_title": string,"organization_name": string
            }[]
                           },
"chat_push_targets":
{ Args: { "p_message": string }; Returns: {
              "auth": string,"endpoint": string,"locale": string,"p256dh": string,"subscription_id": string,"user_id": string
            }[]
                           },
"chat_react":
{ Args: { "p_emoji": string,"p_message": string }; Returns: boolean
                           },
"chat_send":
{ Args: { "p_attachments"?: Json,"p_body": string,"p_channel": string }; Returns: string
                           },
"chat_unread_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"claim_emails":
{ Args: { "p_limit"?: number }; Returns: Json
                           },
"claim_file_texts":
{ Args: { "p_limit"?: number }; Returns: Json
                           },
"claim_push_jobs":
{ Args: { "p_limit"?: number }; Returns: {
              "id": number,"kind": string,"only_subs": (string)[],"ref_id": string
            }[]
                           },
"clear_project_geo":
{ Args: { "p_project": string }; Returns: undefined
                           },
"clear_walk_result":
{ Args: { "p_item": string,"p_walk": string }; Returns: undefined
                           },
"close_budget_month":
{ Args: { "p_month": string,"p_project": string }; Returns: undefined
                           },
"close_planning_period":
{ Args: { "p_force"?: boolean,"p_period": string }; Returns: Json
                           },
"close_sprint":
{ Args: { "p_carry_to"?: string,"p_force"?: boolean,"p_reasons"?: Json,"p_sprint": string }; Returns: Json
                           },
"create_budget_draft":
{ Args: { "p_name"?: string,"p_project": string }; Returns: string
                           },
"create_constraint":
{ Args: { "p_activity": string,"p_assignee"?: string,"p_due"?: string,"p_kind": string,"p_title": string }; Returns: string
                           },
"create_document":
{ Args: { "p_code": string,"p_discipline": string,"p_doc_type": string,"p_file": string,"p_locations"?: (string)[],"p_note": string,"p_orgs"?: (string)[],"p_project": string,"p_publish"?: boolean,"p_requires_ack": boolean,"p_revision": string,"p_title": string,"p_visibility": string }; Returns: string
                           },
"create_folder":
{ Args: { "p_name": string,"p_parent": string,"p_project": string }; Returns: string
                           },
"create_meeting":
{ Args: { "p_agenda"?: (string)[],"p_duration_min"?: number,"p_facilitator"?: string,"p_participants"?: (string)[],"p_place"?: string,"p_project": string,"p_scheduled_at": string,"p_title": string,"p_type": string,"p_visibility"?: string }; Returns: string
                           },
"create_meeting_series":
{ Args: { "p_agenda"?: (string)[],"p_duration_min"?: number,"p_ends_on"?: string,"p_facilitator"?: string,"p_participants"?: (string)[],"p_place"?: string,"p_project": string,"p_slots": Json,"p_starts_on": string,"p_title": string,"p_type": string,"p_visibility"?: string }; Returns: string
                           },
"create_planning_period":
{ Args: { "p_project": string,"p_week": string }; Returns: string
                           },
"create_schedule_baseline":
{ Args: { "p_name": string,"p_project": string,"p_reason"?: string }; Returns: string
                           },
"create_signature_request":
{ Args: { "p_document": string,"p_message": string,"p_sequential": boolean,"p_signers": (string)[] }; Returns: string
                           },
"create_snapshot":
{ Args: { "p_note"?: string,"p_project": string }; Returns: string
                           },
"create_sprint":
{ Args: { "p_discipline"?: string,"p_ends": string,"p_goal"?: string,"p_name": string,"p_project": string,"p_starts": string }; Returns: string
                           },
"create_task":
{ Args: { "p_assignee"?: string,"p_discipline"?: string,"p_due_date"?: string,"p_location"?: string,"p_organization"?: string,"p_parent"?: string,"p_priority"?: string,"p_project": string,"p_title": string,"p_type"?: string }; Returns: {
              "actual_start": string | null,
"assignee_id": string | null,
"blocked_comment": string | null,
"blocked_reason_code": string | null,
"closed_at": string | null,
"completed_at": string | null,
"created_at": string,
"created_by": string | null,
"custom": NonNullable<Json>,
"deleted_at": string | null,
"description": Json | null,
"discipline_id": string | null,
"due_date": string | null,
"estimate_hours": number | null,
"id": string,
"key": string,
"location_id": string | null,
"location_path": string | null,
"meeting_id": string | null,
"need_by_date": string | null,
"number": number,
"organization_id": string | null,
"parent_id": string | null,
"planned_start": string | null,
"priority": string,
"priority_rank": number | null,
"project_id": string,
"reporter_id": string,
"source_id": string | null,
"source_type": string | null,
"spent_hours": number | null,
"status_category": string,
"status_id": string,
"status_rank": number | null,
"tags": (string)[],
"tenant_id": string,
"title": string,
"type": string,
"updated_at": string,
"updated_by": string | null,
"version": number,
"visibility": string,
"workflow_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_task_on_plan":
{ Args: { "p_assignee"?: string,"p_document": string,"p_due_date"?: string,"p_location"?: string,"p_page": number,"p_priority"?: string,"p_project": string,"p_title": string,"p_type"?: string,"p_x": number,"p_x2"?: number,"p_y": number,"p_y2"?: number }; Returns: {
              "actual_start": string | null,
"assignee_id": string | null,
"blocked_comment": string | null,
"blocked_reason_code": string | null,
"closed_at": string | null,
"completed_at": string | null,
"created_at": string,
"created_by": string | null,
"custom": NonNullable<Json>,
"deleted_at": string | null,
"description": Json | null,
"discipline_id": string | null,
"due_date": string | null,
"estimate_hours": number | null,
"id": string,
"key": string,
"location_id": string | null,
"location_path": string | null,
"meeting_id": string | null,
"need_by_date": string | null,
"number": number,
"organization_id": string | null,
"parent_id": string | null,
"planned_start": string | null,
"priority": string,
"priority_rank": number | null,
"project_id": string,
"reporter_id": string,
"source_id": string | null,
"source_type": string | null,
"spent_hours": number | null,
"status_category": string,
"status_id": string,
"status_rank": number | null,
"tags": (string)[],
"tenant_id": string,
"title": string,
"type": string,
"updated_at": string,
"updated_by": string | null,
"version": number,
"visibility": string,
"workflow_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"custom_access_token_hook":
{ Args: { "event": Json }; Returns: Json
                           },
"decide_progress":
{ Args: { "p_approve": boolean,"p_entry": string,"p_note"?: string }; Returns: undefined
                           },
"decline_signature_request":
{ Args: { "p_reason": string,"p_request": string }; Returns: undefined
                           },
"delete_commitment":
{ Args: { "p_commitment": string }; Returns: undefined
                           },
"delete_folder":
{ Args: { "p_folder": string }; Returns: undefined
                           },
"delete_meeting_recording":
{ Args: { "p_recording": string }; Returns: string
                           },
"discard_budget_draft":
{ Args: { "p_version": string }; Returns: undefined
                           },
"end_meeting_series":
{ Args: { "p_series": string }; Returns: number
                           },
"ensure_folder_path":
{ Args: { "p_base": string,"p_path": (string)[],"p_project": string }; Returns: string
                           },
"entity_image_add":
{ Args: { "p_caption"?: string,"p_entity": string,"p_file": string,"p_folder"?: string,"p_project": string,"p_type": string }; Returns: string
                           },
"entity_image_add_version":
{ Args: { "p_file": string,"p_image": string,"p_note"?: string }; Returns: number
                           },
"entity_image_delete":
{ Args: { "p_image": string }; Returns: (string)[]
                           },
"entity_image_folder_delete":
{ Args: { "p_entity": string,"p_folder": string,"p_project": string,"p_type": string }; Returns: (string)[]
                           },
"entity_image_folder_move":
{ Args: { "p_entity": string,"p_folder": string,"p_project": string,"p_to_entity"?: string,"p_to_folder"?: string,"p_to_type"?: string,"p_type": string }; Returns: number
                           },
"entity_image_folders_merge":
{ Args: { "p_entity": string,"p_folders": (string)[],"p_project": string,"p_target": string,"p_type": string }; Returns: number
                           },
"entity_image_move":
{ Args: { "p_folder": string,"p_image": string }; Returns: undefined
                           },
"entity_image_restore":
{ Args: { "p_image": string,"p_version": number }; Returns: undefined
                           },
"entity_image_set":
{ Args: { "p_caption": string,"p_cover": boolean,"p_image": string }; Returns: undefined
                           },
"entity_image_set_plan":
{ Args: { "p_image": string,"p_plan": boolean }; Returns: undefined
                           },
"entity_image_version_delete":
{ Args: { "p_image": string,"p_version": number }; Returns: string
                           },
"evaluate_signals":
{ Args: { "p_project": string }; Returns: Json
                           },
"evm_calc":
{ Args: { "p_date"?: string,"p_project": string }; Returns: Json
                           },
"evm_series":
{ Args: { "p_from": string,"p_project": string,"p_step"?: number,"p_to": string }; Returns: {
              "day": string,"pv": number
            }[]
                           },
"ffe_contract_add_scope":
{ Args: { "p_contract": string,"p_locations": (string)[],"p_move"?: boolean,"p_project": string }; Returns: number
                           },
"ffe_contract_delete":
{ Args: { "p_id": string,"p_project": string }; Returns: undefined
                           },
"ffe_contract_remove_scope":
{ Args: { "p_contract": string,"p_locations": (string)[],"p_project": string }; Returns: number
                           },
"ffe_contract_set_price":
{ Args: { "p_contract": string,"p_item": string,"p_price": number,"p_project": string }; Returns: undefined
                           },
"ffe_contract_upsert":
{ Args: { "p_cbs_item": string,"p_contractor_name": string,"p_contractor_signatory": string,"p_id": string,"p_note": string,"p_number": string,"p_organization": string,"p_project": string,"p_signed_by": string,"p_signed_on": string,"p_status": string,"p_title": string }; Returns: string
                           },
"ffe_contracts_resync":
{ Args: { "p_project": string }; Returns: number
                           },
"ffe_delete_item":
{ Args: { "p_id": string,"p_project": string }; Returns: undefined
                           },
"ffe_import_items":
{ Args: { "p_project": string,"p_rows": Json }; Returns: Json
                           },
"ffe_overview":
{ Args: { "p_project": string }; Returns: Json
                           },
"ffe_upsert_item":
{ Args: { "p_category"?: string,"p_code": string,"p_document"?: string,"p_id": string,"p_name": string,"p_note"?: string,"p_project": string,"p_unit"?: string }; Returns: string
                           },
"field_note_notify":
{ Args: { "p_comment": string }; Returns: undefined
                           },
"field_note_push_info":
{ Args: { "p_comment": string }; Returns: {
              "author_name": string,"body_text": string,"location_label": string,"location_path": string,"photo_count": number,"photo_key": string,"project_code": string
            }[]
                           },
"field_note_push_targets":
{ Args: { "p_comment": string }; Returns: {
              "auth": string,"endpoint": string,"locale": string,"p256dh": string,"subscription_id": string,"user_id": string
            }[]
                           },
"file_thumb_mark":
{ Args: { "p_file": string }; Returns: undefined
                           },
"finish_email":
{ Args: { "p_error"?: string,"p_id": string,"p_ok": boolean }; Returns: undefined
                           },
"finish_file_text":
{ Args: { "p_error"?: string,"p_file": string,"p_method"?: string,"p_status": string,"p_text"?: string }; Returns: undefined
                           },
"finish_push_job":
{ Args: { "p_error"?: string,"p_id": number,"p_retry"?: (string)[],"p_sent": number }; Returns: undefined
                           },
"floor_board":
{ Args: { "p_floor": string }; Returns: {
              "area": number,"code": string,"cover_key": string,"ffe_installed": number,"ffe_total": number,"id": string,"name": string,"path": string,"purpose": string,"tasks_open": number,"tasks_overdue": number,"type_id": string,"type_name": string
            }[]
                           },
"generate_building":
{ Args: { "p_code": string,"p_floor_from"?: number,"p_floor_to"?: number,"p_name": string,"p_project": string,"p_sections"?: number }; Returns: number
                           },
"generate_rooms":
{ Args: { "p_floor_from"?: number,"p_floor_to"?: number,"p_parent": string,"p_per_floor": number,"p_project": string,"p_purpose"?: string,"p_scheme"?: string }; Returns: number
                           },
"generate_schedule_by_locations":
{ Args: { "p_chain"?: boolean,"p_discipline"?: string,"p_duration"?: number,"p_lag"?: number,"p_locations": (string)[],"p_name": string,"p_parent"?: string,"p_project": string }; Returns: number
                           },
"global_search":
{ Args: { "p_query": string }; Returns: {
              "id": string,"kind": string,"project_code": string,"rank": number,"ref": string,"snippet": string,"subtitle": string,"title": string
            }[]
                           },
"import_budget":
{ Args: { "p_rows": Json,"p_version": string }; Returns: Json
                           },
"import_budget_actuals":
{ Args: { "p_project": string,"p_rows": Json }; Returns: number
                           },
"import_budget_commitments":
{ Args: { "p_project": string,"p_rows": Json }; Returns: number
                           },
"import_budget_lookahead":
{ Args: { "p_payload": Json,"p_version": string }; Returns: Json
                           },
"import_work_items":
{ Args: { "p_dry_run"?: boolean,"p_project": string,"p_rows": Json }; Returns: Json
                           },
"inspection_assign_all":
{ Args: { "p_assignee"?: string,"p_due"?: string,"p_org"?: string,"p_report": string }; Returns: number
                           },
"inspection_assign_many":
{ Args: { "p_items": Json,"p_report": string }; Returns: number
                           },
"inspection_delete":
{ Args: { "p_report": string }; Returns: undefined
                           },
"inspection_issue":
{ Args: { "p_report": string }; Returns: undefined
                           },
"inspection_item_assign":
{ Args: { "p_assignee"?: string,"p_due"?: string,"p_item": string,"p_org"?: string }; Returns: string
                           },
"inspection_item_delete":
{ Args: { "p_item": string }; Returns: undefined
                           },
"inspection_item_point":
{ Args: { "p_item": string,"p_x"?: number,"p_y"?: number }; Returns: undefined
                           },
"inspection_item_resolve":
{ Args: { "p_item": string,"p_resolved"?: boolean }; Returns: undefined
                           },
"inspection_item_save":
{ Args: { "p_comment"?: string,"p_id"?: string,"p_section": string,"p_status"?: string }; Returns: string
                           },
"inspection_photo_add":
{ Args: { "p_caption"?: string,"p_file": string,"p_item"?: string,"p_report": string }; Returns: string
                           },
"inspection_photo_delete":
{ Args: { "p_photo": string }; Returns: undefined
                           },
"inspection_reopen":
{ Args: { "p_report": string }; Returns: undefined
                           },
"inspection_save":
{ Args: { "p_contractor"?: string,"p_date"?: string,"p_id"?: string,"p_location"?: string,"p_note"?: string,"p_project": string,"p_scheme_text"?: string,"p_title"?: string }; Returns: string
                           },
"inspection_schedule_delete":
{ Args: { "p_id": string }; Returns: undefined
                           },
"inspection_schedule_run":
{ Args: { "p_id": string }; Returns: string
                           },
"inspection_schedule_save":
{ Args: { "p_active"?: boolean,"p_contractor"?: string,"p_id"?: string,"p_location"?: string,"p_next_due"?: string,"p_period_days"?: number,"p_project": string,"p_title"?: string }; Returns: string
                           },
"inspection_scheme_options":
{ Args: { "p_location": string }; Returns: {
              "file_id": string,"kind": string,"mime": string,"name": string,"ord": number,"source": string,"storage_key": string,"title": string,"version_id": string
            }[]
                           },
"inspection_section_add":
{ Args: { "p_report": string,"p_title": string }; Returns: string
                           },
"inspection_section_delete":
{ Args: { "p_section": string }; Returns: undefined
                           },
"inspection_section_set":
{ Args: { "p_ok"?: boolean,"p_section": string,"p_title"?: string }; Returns: undefined
                           },
"inspection_set_scheme":
{ Args: { "p_file"?: string,"p_report": string,"p_version"?: string }; Returns: undefined
                           },
"inspection_sign":
{ Args: { "p_file"?: string,"p_name": string,"p_report": string,"p_side": string }; Returns: undefined
                           },
"inspection_sign_clear":
{ Args: { "p_report": string,"p_side": string }; Returns: undefined
                           },
"inspection_task_stats":
{ Args: { "p_project": string }; Returns: {
              "active": number,"done": number,"overdue": number,"ready": boolean,"remarks": number,"report_id": string,"resolved": number,"review": number,"with_task": number
            }[]
                           },
"link_field_note_task":
{ Args: { "p_comment": string,"p_task": string }; Returns: undefined
                           },
"location_set_kind":
{ Args: { "p_floor_no"?: number,"p_id": string,"p_kind": string,"p_project": string }; Returns: undefined
                           },
"locations_reorder":
{ Args: { "p_ids": (string)[],"p_parent": string,"p_project": string }; Returns: number
                           },
"mail_calendar_apply":
{ Args: { "p_items": Json,"p_user": string }; Returns: Json
                           },
"mail_notify":
{ Args: { "p_cursor": string,"p_items": Json,"p_user": string }; Returns: number
                           },
"material_request_attach":
{ Args: { "p_file": string,"p_quote"?: string,"p_request": string }; Returns: string
                           },
"material_request_budget":
{ Args: { "p_request": string }; Returns: Json
                           },
"material_request_decide":
{ Args: { "p_approve": boolean,"p_note"?: string,"p_request": string }; Returns: undefined
                           },
"material_request_delivery":
{ Args: { "p_expected"?: string,"p_forwarder"?: string,"p_in_transit": boolean,"p_note"?: string,"p_request": string,"p_tracking"?: string,"p_transport"?: string }; Returns: undefined
                           },
"material_request_detach":
{ Args: { "p_attachment": string }; Returns: undefined
                           },
"material_request_order":
{ Args: { "p_cbs_item"?: string,"p_expected"?: string,"p_order_ref"?: string,"p_request": string }; Returns: undefined
                           },
"material_request_receive":
{ Args: { "p_lines"?: Json,"p_note"?: string,"p_request": string,"p_result": string }; Returns: undefined
                           },
"material_request_save":
{ Args: { "p_cbs_item"?: string,"p_id"?: string,"p_lines"?: Json,"p_needed_by"?: string,"p_note"?: string,"p_project": string,"p_title": string,"p_urgent"?: boolean }; Returns: string
                           },
"material_request_send_approval":
{ Args: { "p_approvers": (string)[],"p_note"?: string,"p_quote": string,"p_reason"?: string,"p_request": string }; Returns: undefined
                           },
"material_request_set_item":
{ Args: { "p_item": string,"p_request": string }; Returns: undefined
                           },
"material_request_stock":
{ Args: { "p_note"?: string,"p_request": string,"p_status": string }; Returns: undefined
                           },
"material_request_transition":
{ Args: { "p_note"?: string,"p_request": string,"p_to": string }; Returns: undefined
                           },
"meeting_summary_accept":
{ Args: { "p_key": string,"p_summary": string }; Returns: undefined
                           },
"meeting_summary_delete":
{ Args: { "p_summary": string }; Returns: undefined
                           },
"meeting_summary_request":
{ Args: { "p_recording": string,"p_reuse_transcript"?: boolean }; Returns: string
                           },
"meeting_transcript_allowed":
{ Args: { "p_meeting": string }; Returns: boolean
                           },
"move_documents":
{ Args: { "p_documents": (string)[],"p_folder": string }; Returns: number
                           },
"move_folder":
{ Args: { "p_folder": string,"p_parent": string }; Returns: undefined
                           },
"my_blocked_modules":
{ Args: { "p_project": string }; Returns: (string)[]
                           },
"my_notification_counts":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_permissions":
{ Args: { "p_project"?: string }; Returns: (string)[]
                           },
"my_signatures":
{ Args: { "p_limit"?: number }; Returns: {
              "batch_id": string,"codes": (string)[],"document_id": string,"document_title": string,"file_name": string,"file_path": string,"hash_after": string,"marks": number,"pages": (number)[],"project_code": string,"signed_at": string,"source": string,"storage_key": string
            }[]
                           },
"my_tenant_permissions":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"notification_push_targets":
{ Args: { "p_notification": string }; Returns: {
              "auth": string,"endpoint": string,"locale": string,"p256dh": string,"subscription_id": string,"user_id": string
            }[]
                           },
"org_disciplines_set":
{ Args: { "p_disciplines": (string)[],"p_org": string,"p_project": string }; Returns: number
                           },
"org_member_update":
{ Args: { "p_discipline": string,"p_member": string }; Returns: undefined
                           },
"organization_create":
{ Args: { "p_kind"?: string,"p_name": string,"p_project": string,"p_tax_id"?: string }; Returns: string
                           },
"organization_update":
{ Args: { "p_contacts": Json,"p_is_active": boolean,"p_kind": string,"p_name": string,"p_org": string,"p_short_name": string,"p_tax_id": string }; Returns: undefined
                           },
"people_directory":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_path": string,"email": string,"full_name": string,"id": string,"is_external": boolean,"job_title": string,"organization_id": string,"organization_kind": string,"organization_name": string,"phone": string,"projects": Json,"status": string
            }[]
                           },
"pin_task":
{ Args: { "p_document": string,"p_page": number,"p_task": string,"p_x": number,"p_x2"?: number,"p_y": number,"p_y2"?: number }; Returns: string
                           },
"plan_furniture_mark_add":
{ Args: { "p_document": string,"p_item": string,"p_page": number,"p_project": string,"p_x": number,"p_x2"?: number,"p_y": number,"p_y2"?: number }; Returns: string
                           },
"plan_furniture_mark_delete":
{ Args: { "p_mark": string }; Returns: undefined
                           },
"plan_object_delete":
{ Args: { "p_object": string }; Returns: undefined
                           },
"plan_object_set":
{ Args: { "p_color"?: string,"p_document": string,"p_geometry": string,"p_id"?: string,"p_label"?: string,"p_notes"?: string,"p_page": number,"p_points": Json,"p_project": string,"p_rotation"?: number,"p_size"?: number,"p_specs"?: Json,"p_status"?: string,"p_type": string,"p_variant"?: string }; Returns: string
                           },
"plan_objects_summary":
{ Args: { "p_project": string }; Returns: {
              "checked": number,"defect": number,"geometry": string,"installed": number,"planned": number,"total": number,"type_code": string
            }[]
                           },
"plan_scale_set":
{ Args: { "p_document": string,"p_meters_per_width": number,"p_page": number,"p_project": string }; Returns: undefined
                           },
"plan_zone_delete":
{ Args: { "p_zone": string }; Returns: undefined
                           },
"plan_zone_set":
{ Args: { "p_document": string,"p_location": string,"p_page": number,"p_points": Json,"p_project": string }; Returns: string
                           },
"plan_zone_set_many":
{ Args: { "p_document": string,"p_locations": (string)[],"p_page": number,"p_points": Json,"p_project": string }; Returns: number
                           },
"plan_zones":
{ Args: { "p_document": string }; Returns: {
              "code": string,"ffe_installed": number,"ffe_total": number,"id": string,"kind": string,"location_id": string,"name": string,"page": number,"path": string,"points": Json,"purpose": string,"tasks_open": number,"tasks_overdue": number,"type_name": string
            }[]
                           },
"presence_ping":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"procurement_people":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"procurement_price_hints":
{ Args: { "p_names": (string)[] }; Returns: Json
                           },
"procurement_request":
{ Args: { "p_id": string }; Returns: Json
                           },
"procurement_requests":
{ Args: { "p_project"?: string }; Returns: Json
                           },
"procurement_settings_get":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"procurement_settings_save":
{ Args: { "p_approval": number,"p_committee": number,"p_confirm": number,"p_sourcing": number,"p_stock": number,"p_tier1": number,"p_tier2": number }; Returns: undefined
                           },
"procurement_suggest_for":
{ Args: { "p_amount_gel": number,"p_request": string }; Returns: Json
                           },
"project_dashboard":
{ Args: { "p_project": string }; Returns: Json
                           },
"project_file_catalog":
{ Args: { "p_project": string }; Returns: {
              "created_at": string,"document_id": string,"file_id": string,"file_mime": string,"file_name": string,"has_thumb": boolean,"key": string,"kind": string,"storage_key": string,"subtitle": string,"thumb_file_id": string,"thumb_source_key": string,"thumb_source_mime": string,"title": string
            }[]
                           },
"project_orgs_overview":
{ Args: { "p_project": string }; Returns: {
              "discipline_ids": (string)[],"kind": string,"members": number,"name": string,"open_tasks": number,"organization_id": string,"overdue_tasks": number,"tax_id": string,"work_items": number
            }[]
                           },
"projects_progress":
{ Args: Record<PropertyKey, never>; Returns: {
              "items": number,"open_discrepancies": number,"percent": number,"project_id": string,"reported": number
            }[]
                           },
"publish_document_version":
{ Args: { "p_version": string }; Returns: undefined
                           },
"push_public_key":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"push_subscribe":
{ Args: { "p_auth": string,"p_endpoint": string,"p_p256dh": string,"p_user_agent"?: string }; Returns: undefined
                           },
"push_unsubscribe":
{ Args: { "p_endpoint": string }; Returns: undefined
                           },
"recalculate_schedule":
{ Args: { "p_project": string }; Returns: Json
                           },
"record_signature":
{ Args: { "p_codes": (string)[],"p_file_name": string,"p_file_path"?: string,"p_hash_after": string,"p_hash_before": string,"p_pages": (number)[],"p_user_agent": string }; Returns: string
                           },
"register_field_note":
{ Args: { "p_comment": string,"p_org"?: string,"p_scheme_file"?: string,"p_scheme_version"?: string,"p_task"?: string,"p_user"?: string,"p_x"?: number,"p_y"?: number }; Returns: undefined
                           },
"remove_org_member":
{ Args: { "p_member": string }; Returns: undefined
                           },
"remove_sprint_task":
{ Args: { "p_sprint": string,"p_task": string }; Returns: undefined
                           },
"rename_folder":
{ Args: { "p_folder": string,"p_name": string }; Returns: undefined
                           },
"reopen_budget_month":
{ Args: { "p_project": string }; Returns: string
                           },
"reopen_daily_log":
{ Args: { "p_id": string }; Returns: undefined
                           },
"report_progress":
{ Args: { "p_activity": string,"p_date": string,"p_note"?: string,"p_value": number }; Returns: string
                           },
"reschedule_meeting":
{ Args: { "p_meeting": string,"p_new_at": string,"p_scope"?: string }; Returns: undefined
                           },
"resolve_discrepancy":
{ Args: { "p_check": string,"p_note"?: string,"p_resolution": string }; Returns: {
              "checked_at": string,
"checked_by": string,
"delta": number | null,
"id": string,
"independent": boolean,
"observed_qty": number,
"project_id": string,
"reported_qty": number,
"resolution": string | null,
"resolution_note": string | null,
"resolved_at": string | null,
"resolved_by": string | null,
"tenant_id": string,
"verdict": string,
"walk_id": string,
"work_item_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "work_checks"
        isOneToOne: true
        isSetofReturn: false
      } },
"rfq_award":
{ Args: { "p_cbs_item"?: string,"p_doc_number"?: string,"p_quote": string,"p_rfq": string }; Returns: string
                           },
"rfq_cancel":
{ Args: { "p_note"?: string,"p_rfq": string }; Returns: undefined
                           },
"rfq_create":
{ Args: { "p_due"?: string,"p_lines"?: Json,"p_note"?: string,"p_project": string,"p_request"?: string,"p_title": string }; Returns: string
                           },
"rfq_quote_delete":
{ Args: { "p_quote": string }; Returns: undefined
                           },
"rfq_quote_save":
{ Args: { "p_currency": string,"p_delivery_days"?: number,"p_id"?: string,"p_note"?: string,"p_prices"?: Json,"p_rfq": string,"p_supplier": string,"p_terms"?: string }; Returns: string
                           },
"risk_delete":
{ Args: { "p_risk": string }; Returns: undefined
                           },
"risk_save":
{ Args: { "p_category"?: string,"p_cost_impact"?: number,"p_description"?: string,"p_id"?: string,"p_impact"?: number,"p_mitigation"?: string,"p_owner"?: string,"p_probability"?: number,"p_project": string,"p_response"?: string,"p_review_date"?: string,"p_schedule_days"?: number,"p_status"?: string,"p_title": string,"p_trigger"?: string }; Returns: string
                           },
"role_create":
{ Args: { "p_copy_from"?: string,"p_name": string,"p_scope": string }; Returns: string
                           },
"role_delete":
{ Args: { "p_role": string }; Returns: undefined
                           },
"role_holders":
{ Args: { "p_role": string }; Returns: {
              "email": string,"full_name": string,"job_title": string,"project_code": string,"user_id": string
            }[]
                           },
"role_rename":
{ Args: { "p_name": string,"p_role": string }; Returns: undefined
                           },
"role_set_permissions":
{ Args: { "p_permissions": (string)[],"p_role": string }; Returns: Json
                           },
"roles_overview":
{ Args: Record<PropertyKey, never>; Returns: {
              "code": string,"holder_count": number,"id": string,"is_external": boolean,"is_system": boolean,"name": string,"permission_count": number,"scope": string
            }[]
                           },
"room_ffe_set":
{ Args: { "p_item": string,"p_location": string,"p_project": string,"p_qty": number }; Returns: undefined
                           },
"room_ffe_set_status":
{ Args: { "p_ids": (string)[],"p_project": string,"p_status": string }; Returns: number
                           },
"room_set_specs":
{ Args: { "p_area": number,"p_location": string,"p_name": string,"p_project": string,"p_specs": string }; Returns: undefined
                           },
"room_type_delete":
{ Args: { "p_id": string,"p_project": string }; Returns: undefined
                           },
"room_type_set_item":
{ Args: { "p_item": string,"p_project": string,"p_qty": number,"p_type": string }; Returns: number
                           },
"room_type_upsert":
{ Args: { "p_area"?: number,"p_id": string,"p_name": string,"p_project": string,"p_specs"?: string }; Returns: string
                           },
"save_daily_log":
{ Args: { "p_data": Json,"p_date": string,"p_project": string }; Returns: string
                           },
"save_walk_result":
{ Args: { "p_comment"?: string,"p_item": string,"p_qty"?: number,"p_reason_code"?: string,"p_result": string,"p_walk": string }; Returns: {
              "comment": string | null,
"qty": number | null,
"reason_code": string | null,
"result": string,
"tenant_id": string,
"updated_at": string,
"walk_id": string,
"work_item_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "site_walk_results"
        isOneToOne: true
        isSetofReturn: false
      } },
"search_documents":
{ Args: { "p_project": string,"p_query": string }; Returns: {
              "document_id": string,"rank": number,"revision": string,"snippet": string,"version_id": string
            }[]
                           },
"set_activity_checked":
{ Args: { "p_activity": string,"p_checked": boolean }; Returns: undefined
                           },
"set_birthday":
{ Args: { "p_date": string,"p_show_year"?: boolean,"p_user": string }; Returns: undefined
                           },
"set_budget_amount":
{ Args: { "p_amount": number,"p_item": string,"p_version": string }; Returns: undefined
                           },
"set_budget_etc":
{ Args: { "p_amount": number,"p_item": string,"p_note"?: string }; Returns: undefined
                           },
"set_budget_forecast":
{ Args: { "p_amount": number,"p_item": string,"p_month": string }; Returns: undefined
                           },
"set_commitment_result":
{ Args: { "p_commitment": string,"p_reason"?: string,"p_reason_note"?: string,"p_result": string }; Returns: undefined
                           },
"set_field_note_addressee":
{ Args: { "p_comment": string,"p_org"?: string,"p_user"?: string }; Returns: undefined
                           },
"set_field_note_status":
{ Args: { "p_comment": string,"p_done": boolean }; Returns: undefined
                           },
"set_location_purpose":
{ Args: { "p_ids": (string)[],"p_project": string,"p_purpose": string }; Returns: number
                           },
"set_meeting_status":
{ Args: { "p_meeting": string,"p_to": string }; Returns: undefined
                           },
"set_my_avatar":
{ Args: { "p_path": string }; Returns: undefined
                           },
"set_my_locale":
{ Args: { "p_locale": string }; Returns: undefined
                           },
"set_progress_method":
{ Args: { "p_activity": string,"p_method": string,"p_qty"?: number,"p_unit"?: string }; Returns: undefined
                           },
"set_project_cover":
{ Args: { "p_file": string,"p_project": string }; Returns: undefined
                           },
"set_project_dates":
{ Args: { "p_finish": string,"p_project": string,"p_reason"?: string,"p_shift_schedule"?: boolean,"p_start": string }; Returns: Json
                           },
"set_project_geo":
{ Args: { "p_lat": number,"p_lon": number,"p_place"?: string,"p_project": string }; Returns: undefined
                           },
"set_project_module_access":
{ Args: { "p_module": string,"p_project": string,"p_restricted": boolean,"p_roles"?: (string)[],"p_users"?: (string)[] }; Returns: undefined
                           },
"set_project_modules":
{ Args: { "p_modules": (string)[],"p_project": string }; Returns: (string)[]
                           },
"set_user_blocked":
{ Args: { "p_blocked": boolean,"p_user": string }; Returns: string
                           },
"set_version_preview":
{ Args: { "p_file": string,"p_version": string }; Returns: undefined
                           },
"sign_signature_request":
{ Args: { "p_base_file": string,"p_codes": (string)[],"p_file": string,"p_hash_after": string,"p_hash_before": string,"p_pages": (number)[],"p_request": string,"p_user_agent": string }; Returns: Json
                           },
"signal_assign":
{ Args: { "p_signal": string,"p_user": string }; Returns: undefined
                           },
"signal_create_task":
{ Args: { "p_assignee"?: string,"p_due"?: string,"p_signal": string,"p_title": string }; Returns: string
                           },
"signal_dismiss":
{ Args: { "p_days"?: number,"p_reason": string,"p_signal": string }; Returns: undefined
                           },
"signal_feedback":
{ Args: { "p_signal": string,"p_useful": boolean }; Returns: undefined
                           },
"signal_rule_reset":
{ Args: { "p_project": string,"p_rule": string }; Returns: undefined
                           },
"signal_rule_set":
{ Args: { "p_enabled": boolean,"p_params"?: Json,"p_project": string,"p_rule": string }; Returns: undefined
                           },
"signal_rules":
{ Args: { "p_project": string }; Returns: Json
                           },
"signal_to_agenda":
{ Args: { "p_meeting": string,"p_signal": string }; Returns: undefined
                           },
"spread_budget_forecast":
{ Args: { "p_amount": number,"p_from": string,"p_item": string,"p_months": number,"p_shape"?: string }; Returns: undefined
                           },
"staff_review_assess":
{ Args: { "p_goals": string,"p_rating": number,"p_review": string,"p_share"?: boolean,"p_text": string }; Returns: undefined
                           },
"staff_review_self":
{ Args: { "p_review": string,"p_submit"?: boolean,"p_text": string }; Returns: undefined
                           },
"staff_review_start":
{ Args: { "p_due": string,"p_period": string,"p_reviewer"?: string,"p_user": string }; Returns: string
                           },
"start_planning_period":
{ Args: { "p_period": string }; Returns: undefined
                           },
"start_sprint":
{ Args: { "p_sprint": string }; Returns: undefined
                           },
"start_walk":
{ Args: { "p_kind"?: string,"p_location": string,"p_project": string }; Returns: {
              "approved_at": string | null,
"approved_by": string | null,
"author_id": string,
"id": string,
"kind": string,
"location_id": string,
"location_path": string,
"project_id": string,
"started_at": string,
"status": string,
"submitted_at": string | null,
"tenant_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "site_walks"
        isOneToOne: true
        isSetofReturn: false
      } },
"submit_daily_log":
{ Args: { "p_id": string }; Returns: undefined
                           },
"submit_walk":
{ Args: { "p_walk": string }; Returns: {
              "approved_at": string | null,
"approved_by": string | null,
"author_id": string,
"id": string,
"kind": string,
"location_id": string,
"location_path": string,
"project_id": string,
"started_at": string,
"status": string,
"submitted_at": string | null,
"tenant_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "site_walks"
        isOneToOne: true
        isSetofReturn: false
      } },
"supplier_history":
{ Args: { "p_id": string }; Returns: Json
                           },
"supplier_save":
{ Args: { "p_address"?: string,"p_category"?: string,"p_contact"?: string,"p_country"?: string,"p_email"?: string,"p_id": string,"p_name": string,"p_note"?: string,"p_phone"?: string,"p_status"?: string,"p_tax_id"?: string }; Returns: string
                           },
"suppliers_list":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"task_badges":
{ Args: { "p_tasks": (string)[] }; Returns: {
              "attachments": number,"checklist_done": number,"checklist_total": number,"comments": number,"documents": number,"task_id": string
            }[]
                           },
"tenant_role_grant":
{ Args: { "p_role": string,"p_user": string }; Returns: undefined
                           },
"tenant_role_revoke":
{ Args: { "p_role": string,"p_user": string }; Returns: undefined
                           },
"transition_task":
{ Args: { "p_comment"?: string,"p_reason_code"?: string,"p_task": string,"p_to_status": string }; Returns: {
              "actual_start": string | null,
"assignee_id": string | null,
"blocked_comment": string | null,
"blocked_reason_code": string | null,
"closed_at": string | null,
"completed_at": string | null,
"created_at": string,
"created_by": string | null,
"custom": NonNullable<Json>,
"deleted_at": string | null,
"description": Json | null,
"discipline_id": string | null,
"due_date": string | null,
"estimate_hours": number | null,
"id": string,
"key": string,
"location_id": string | null,
"location_path": string | null,
"meeting_id": string | null,
"need_by_date": string | null,
"number": number,
"organization_id": string | null,
"parent_id": string | null,
"planned_start": string | null,
"priority": string,
"priority_rank": number | null,
"project_id": string,
"reporter_id": string,
"source_id": string | null,
"source_type": string | null,
"spent_hours": number | null,
"status_category": string,
"status_id": string,
"status_rank": number | null,
"tags": (string)[],
"tenant_id": string,
"title": string,
"type": string,
"updated_at": string,
"updated_by": string | null,
"version": number,
"visibility": string,
"workflow_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "tasks"
        isOneToOne: true
        isSetofReturn: false
      } },
"unpin_task":
{ Args: { "p_document": string,"p_task": string }; Returns: undefined
                           },
"update_commitment":
{ Args: { "p_commitment": string,"p_location": string,"p_note": string,"p_org": string,"p_responsible": string,"p_title": string }; Returns: undefined
                           },
"update_my_profile":
{ Args: { "p_full_name": string,"p_locale"?: string,"p_phone"?: string,"p_timezone"?: string }; Returns: undefined
                           },
"uuidv7":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"verify_signature":
{ Args: { "p_code"?: string,"p_hash"?: string }; Returns: {
              "batch_id": string,"document_id": string,"document_title": string,"file_name": string,"hash_after": string,"hash_before": string,"id": string,"marks": number,"page": number,"project_code": string,"signed_at": string,"signer_name": string,"source": string
            }[]
                           },
"weather_places":
{ Args: Record<PropertyKey, never>; Returns: {
              "lat": number,"lon": number,"project_id": string
            }[]
                           },
"weather_store":
{ Args: { "p_project": string,"p_rows": Json }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const

