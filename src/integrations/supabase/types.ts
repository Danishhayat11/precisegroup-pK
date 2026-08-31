export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      _seed_adjustments: {
        Row: {
          adjustment_id: string;
          applied_to_ledger: string | null;
          approved_value: number | null;
          asset_description: string | null;
          booking_id: string | null;
          client_name: string | null;
          client_ref: string | null;
          company_id: string;
          company_loss_gain: number | null;
          created_at: string;
          loss_gain_type: string | null;
          note: string | null;
          realized_value: number | null;
          risk_check: string | null;
          unit_id: string | null;
          updated_at: string;
        };
        Insert: {
          adjustment_id: string;
          applied_to_ledger?: string | null;
          approved_value?: number | null;
          asset_description?: string | null;
          booking_id?: string | null;
          client_name?: string | null;
          client_ref?: string | null;
          company_id?: string;
          company_loss_gain?: number | null;
          created_at?: string;
          loss_gain_type?: string | null;
          note?: string | null;
          realized_value?: number | null;
          risk_check?: string | null;
          unit_id?: string | null;
          updated_at?: string;
        };
        Update: {
          adjustment_id?: string;
          applied_to_ledger?: string | null;
          approved_value?: number | null;
          asset_description?: string | null;
          booking_id?: string | null;
          client_name?: string | null;
          client_ref?: string | null;
          company_id?: string;
          company_loss_gain?: number | null;
          created_at?: string;
          loss_gain_type?: string | null;
          note?: string | null;
          realized_value?: number | null;
          risk_check?: string | null;
          unit_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "_seed_adjustments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      _seed_bookings: {
        Row: {
          address: string | null;
          adjustment_credit: number | null;
          base_rate: number | null;
          booking_date: string | null;
          booking_id: string;
          booking_status: string | null;
          cash_received: number | null;
          client_name: string | null;
          client_ref: string | null;
          cnic: string | null;
          company_id: string;
          created_at: string;
          current_overdue_count: number | null;
          dealer_commission_amount: number | null;
          dealer_commission_fixed: number | null;
          dealer_commission_pct: number | null;
          dealer_name: string | null;
          down_payment: number | null;
          first_installment_due: string | null;
          floor: string | null;
          installment_amount: number | null;
          installment_frequency: string | null;
          latest_overdue_date: string | null;
          mobile: string | null;
          net_company_value: number | null;
          next_action: string | null;
          no_of_installments: number | null;
          notes: string | null;
          oldest_overdue_date: string | null;
          possession_amount: number | null;
          possession_due_date: string | null;
          price_loss: number | null;
          project_code: string | null;
          project_name: string | null;
          remaining_balance: number | null;
          risk_level: string | null;
          size_sqft: number | null;
          so_wo: string | null;
          sold_rate: number | null;
          sold_total_override: number | null;
          sold_unit_value: number | null;
          standard_value: number | null;
          total_contract_value: number | null;
          total_overdue_amount: number | null;
          unit_id: string | null;
          unit_type: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          adjustment_credit?: number | null;
          base_rate?: number | null;
          booking_date?: string | null;
          booking_id: string;
          booking_status?: string | null;
          cash_received?: number | null;
          client_name?: string | null;
          client_ref?: string | null;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          current_overdue_count?: number | null;
          dealer_commission_amount?: number | null;
          dealer_commission_fixed?: number | null;
          dealer_commission_pct?: number | null;
          dealer_name?: string | null;
          down_payment?: number | null;
          first_installment_due?: string | null;
          floor?: string | null;
          installment_amount?: number | null;
          installment_frequency?: string | null;
          latest_overdue_date?: string | null;
          mobile?: string | null;
          net_company_value?: number | null;
          next_action?: string | null;
          no_of_installments?: number | null;
          notes?: string | null;
          oldest_overdue_date?: string | null;
          possession_amount?: number | null;
          possession_due_date?: string | null;
          price_loss?: number | null;
          project_code?: string | null;
          project_name?: string | null;
          remaining_balance?: number | null;
          risk_level?: string | null;
          size_sqft?: number | null;
          so_wo?: string | null;
          sold_rate?: number | null;
          sold_total_override?: number | null;
          sold_unit_value?: number | null;
          standard_value?: number | null;
          total_contract_value?: number | null;
          total_overdue_amount?: number | null;
          unit_id?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          adjustment_credit?: number | null;
          base_rate?: number | null;
          booking_date?: string | null;
          booking_id?: string;
          booking_status?: string | null;
          cash_received?: number | null;
          client_name?: string | null;
          client_ref?: string | null;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          current_overdue_count?: number | null;
          dealer_commission_amount?: number | null;
          dealer_commission_fixed?: number | null;
          dealer_commission_pct?: number | null;
          dealer_name?: string | null;
          down_payment?: number | null;
          first_installment_due?: string | null;
          floor?: string | null;
          installment_amount?: number | null;
          installment_frequency?: string | null;
          latest_overdue_date?: string | null;
          mobile?: string | null;
          net_company_value?: number | null;
          next_action?: string | null;
          no_of_installments?: number | null;
          notes?: string | null;
          oldest_overdue_date?: string | null;
          possession_amount?: number | null;
          possession_due_date?: string | null;
          price_loss?: number | null;
          project_code?: string | null;
          project_name?: string | null;
          remaining_balance?: number | null;
          risk_level?: string | null;
          size_sqft?: number | null;
          so_wo?: string | null;
          sold_rate?: number | null;
          sold_total_override?: number | null;
          sold_unit_value?: number | null;
          standard_value?: number | null;
          total_contract_value?: number | null;
          total_overdue_amount?: number | null;
          unit_id?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "_seed_bookings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      _seed_clients: {
        Row: {
          address: string | null;
          client_ref: string;
          cnic: string | null;
          company_id: string;
          created_at: string;
          mobile: string | null;
          name: string;
          so_wo: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          client_ref: string;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          mobile?: string | null;
          name: string;
          so_wo?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          client_ref?: string;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          mobile?: string | null;
          name?: string;
          so_wo?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "_seed_clients_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      _seed_dealers: {
        Row: {
          company_id: string;
          created_at: string;
          name: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          name: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "_seed_dealers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      _seed_installment_ledger: {
        Row: {
          aging_level: string | null;
          booking_id: string;
          client_name: string | null;
          company_id: string;
          created_at: string;
          days_overdue: number | null;
          due_amount: number | null;
          due_date: string | null;
          ledger_id: string;
          next_action: string | null;
          paid_amount: number | null;
          paid_date: string | null;
          particulars: string | null;
          project: string | null;
          running_balance: number | null;
          status: string | null;
          term_no: number | null;
          unit_no: string | null;
          updated_at: string;
        };
        Insert: {
          aging_level?: string | null;
          booking_id: string;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          days_overdue?: number | null;
          due_amount?: number | null;
          due_date?: string | null;
          ledger_id: string;
          next_action?: string | null;
          paid_amount?: number | null;
          paid_date?: string | null;
          particulars?: string | null;
          project?: string | null;
          running_balance?: number | null;
          status?: string | null;
          term_no?: number | null;
          unit_no?: string | null;
          updated_at?: string;
        };
        Update: {
          aging_level?: string | null;
          booking_id?: string;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          days_overdue?: number | null;
          due_amount?: number | null;
          due_date?: string | null;
          ledger_id?: string;
          next_action?: string | null;
          paid_amount?: number | null;
          paid_date?: string | null;
          particulars?: string | null;
          project?: string | null;
          running_balance?: number | null;
          status?: string | null;
          term_no?: number | null;
          unit_no?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "_seed_installment_ledger_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      _seed_payments: {
        Row: {
          account: string | null;
          amount: number;
          booking_id: string | null;
          cash_bank_include: boolean | null;
          cheque_txn_no: string | null;
          client_name: string | null;
          cnic: string | null;
          company_id: string;
          created_at: string;
          memo: string | null;
          non_cash_adjustment: boolean | null;
          payment_date: string | null;
          payment_head: string | null;
          payment_mode: string | null;
          posted_by: string | null;
          project: string | null;
          receipt_no: string;
          received_from: string | null;
          remarks: string | null;
          safe_cash_amount: number | null;
          status: string | null;
          unit_no: string | null;
          updated_at: string;
        };
        Insert: {
          account?: string | null;
          amount: number;
          booking_id?: string | null;
          cash_bank_include?: boolean | null;
          cheque_txn_no?: string | null;
          client_name?: string | null;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          memo?: string | null;
          non_cash_adjustment?: boolean | null;
          payment_date?: string | null;
          payment_head?: string | null;
          payment_mode?: string | null;
          posted_by?: string | null;
          project?: string | null;
          receipt_no: string;
          received_from?: string | null;
          remarks?: string | null;
          safe_cash_amount?: number | null;
          status?: string | null;
          unit_no?: string | null;
          updated_at?: string;
        };
        Update: {
          account?: string | null;
          amount?: number;
          booking_id?: string | null;
          cash_bank_include?: boolean | null;
          cheque_txn_no?: string | null;
          client_name?: string | null;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          memo?: string | null;
          non_cash_adjustment?: boolean | null;
          payment_date?: string | null;
          payment_head?: string | null;
          payment_mode?: string | null;
          posted_by?: string | null;
          project?: string | null;
          receipt_no?: string;
          received_from?: string | null;
          remarks?: string | null;
          safe_cash_amount?: number | null;
          status?: string | null;
          unit_no?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "_seed_payments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      _seed_projects: {
        Row: {
          company_id: string;
          created_at: string;
          expected_completion_date: string | null;
          location: string | null;
          notes: string | null;
          project_code: string;
          project_name: string;
          start_date: string | null;
          status: string | null;
          updated_at: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          expected_completion_date?: string | null;
          location?: string | null;
          notes?: string | null;
          project_code: string;
          project_name: string;
          start_date?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          expected_completion_date?: string | null;
          location?: string | null;
          notes?: string | null;
          project_code?: string;
          project_name?: string;
          start_date?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "_seed_projects_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      _seed_units: {
        Row: {
          base_rate: number | null;
          booked_by: string | null;
          company_id: string;
          created_at: string;
          floor: string | null;
          linked_booking_id: string | null;
          notes: string | null;
          project_code: string;
          project_name: string | null;
          size_sqft: number | null;
          standard_value: number | null;
          status: string | null;
          unit_id: string;
          unit_no: string | null;
          unit_type: string | null;
          updated_at: string;
        };
        Insert: {
          base_rate?: number | null;
          booked_by?: string | null;
          company_id?: string;
          created_at?: string;
          floor?: string | null;
          linked_booking_id?: string | null;
          notes?: string | null;
          project_code: string;
          project_name?: string | null;
          size_sqft?: number | null;
          standard_value?: number | null;
          status?: string | null;
          unit_id: string;
          unit_no?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Update: {
          base_rate?: number | null;
          booked_by?: string | null;
          company_id?: string;
          created_at?: string;
          floor?: string | null;
          linked_booking_id?: string | null;
          notes?: string | null;
          project_code?: string;
          project_name?: string | null;
          size_sqft?: number | null;
          standard_value?: number | null;
          status?: string | null;
          unit_id?: string;
          unit_no?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "_seed_units_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      adjustments: {
        Row: {
          adjustment_id: string;
          applied_to_ledger: string | null;
          approval_date: string | null;
          approved_by: string | null;
          approved_value: number | null;
          asset_description: string | null;
          booking_id: string | null;
          client_name: string | null;
          client_ref: string | null;
          company_id: string;
          company_loss_gain: number | null;
          created_at: string;
          loss_gain_type: string | null;
          note: string | null;
          realization_date: string | null;
          realized_value: number | null;
          risk_check: string | null;
          status: string;
          unit_id: string | null;
          updated_at: string;
        };
        Insert: {
          adjustment_id: string;
          applied_to_ledger?: string | null;
          approval_date?: string | null;
          approved_by?: string | null;
          approved_value?: number | null;
          asset_description?: string | null;
          booking_id?: string | null;
          client_name?: string | null;
          client_ref?: string | null;
          company_id?: string;
          company_loss_gain?: number | null;
          created_at?: string;
          loss_gain_type?: string | null;
          note?: string | null;
          realization_date?: string | null;
          realized_value?: number | null;
          risk_check?: string | null;
          status?: string;
          unit_id?: string | null;
          updated_at?: string;
        };
        Update: {
          adjustment_id?: string;
          applied_to_ledger?: string | null;
          approval_date?: string | null;
          approved_by?: string | null;
          approved_value?: number | null;
          asset_description?: string | null;
          booking_id?: string | null;
          client_name?: string | null;
          client_ref?: string | null;
          company_id?: string;
          company_loss_gain?: number | null;
          created_at?: string;
          loss_gain_type?: string | null;
          note?: string | null;
          realization_date?: string | null;
          realized_value?: number | null;
          risk_check?: string | null;
          status?: string;
          unit_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "adjustments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "adjustments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "adjustments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "adjustments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_access_audit_log: {
        Row: {
          created_at: string;
          event_type: string;
          id: string;
          ip_address: unknown;
          metadata: Json;
          resource: string;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: string;
          ip_address?: unknown;
          metadata?: Json;
          resource: string;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: string;
          ip_address?: unknown;
          metadata?: Json;
          resource?: string;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      ai_tool_call_log: {
        Row: {
          company_id: string;
          completed_at: string | null;
          created_at: string;
          duration_ms: number | null;
          error_message: string | null;
          gateway_model: string | null;
          gateway_status: number | null;
          id: string;
          in_flight: boolean;
          request_id: string;
          retry_strategy: string | null;
          round: number;
          success: boolean;
          tool_args: Json | null;
          tool_name: string | null;
          tool_result: Json | null;
          user_id: string;
        };
        Insert: {
          company_id?: string;
          completed_at?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          error_message?: string | null;
          gateway_model?: string | null;
          gateway_status?: number | null;
          id?: string;
          in_flight?: boolean;
          request_id: string;
          retry_strategy?: string | null;
          round?: number;
          success?: boolean;
          tool_args?: Json | null;
          tool_name?: string | null;
          tool_result?: Json | null;
          user_id: string;
        };
        Update: {
          company_id?: string;
          completed_at?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          error_message?: string | null;
          gateway_model?: string | null;
          gateway_status?: number | null;
          id?: string;
          in_flight?: boolean;
          request_id?: string;
          retry_strategy?: string | null;
          round?: number;
          success?: boolean;
          tool_args?: Json | null;
          tool_name?: string | null;
          tool_result?: Json | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_tool_call_log_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: {
          company_id: string;
          key: string;
          updated_at: string;
          value: Json | null;
        };
        Insert: {
          company_id?: string;
          key: string;
          updated_at?: string;
          value?: Json | null;
        };
        Update: {
          company_id?: string;
          key?: string;
          updated_at?: string;
          value?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "app_settings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      assistant_messages: {
        Row: {
          booking_id: string | null;
          booking_label: string | null;
          company_id: string;
          content: string;
          created_at: string;
          id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          booking_id?: string | null;
          booking_label?: string | null;
          company_id?: string;
          content: string;
          created_at?: string;
          id?: string;
          role: string;
          user_id: string;
        };
        Update: {
          booking_id?: string | null;
          booking_label?: string | null;
          company_id?: string;
          content?: string;
          created_at?: string;
          id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assistant_messages_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string | null;
          after: Json | null;
          before: Json | null;
          company_id: string;
          created_at: string;
          entity: string | null;
          entity_id: string | null;
          id: string;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          company_id?: string;
          created_at?: string;
          entity?: string | null;
          entity_id?: string | null;
          id?: string;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          company_id?: string;
          created_at?: string;
          entity?: string | null;
          entity_id?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_reviewed_issues: {
        Row: {
          booking_id: string | null;
          company_id: string;
          issue_id: string;
          issue_type: string | null;
          note: string | null;
          reviewed_at: string;
          reviewed_by: string;
        };
        Insert: {
          booking_id?: string | null;
          company_id?: string;
          issue_id: string;
          issue_type?: string | null;
          note?: string | null;
          reviewed_at?: string;
          reviewed_by?: string;
        };
        Update: {
          booking_id?: string | null;
          company_id?: string;
          issue_id?: string;
          issue_type?: string | null;
          note?: string | null;
          reviewed_at?: string;
          reviewed_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_reviewed_issues_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_documents: {
        Row: {
          booking_id: string;
          company_id: string;
          created_at: string;
          custom_label: string | null;
          doc_date: string | null;
          file_name: string;
          file_path: string;
          file_size: number;
          id: string;
          label: string;
          mime_type: string | null;
          notes: string | null;
          sent_via: string | null;
          status: string | null;
          tracking_no: string | null;
          updated_at: string;
          uploaded_by: string | null;
          uploaded_by_name: string | null;
        };
        Insert: {
          booking_id: string;
          company_id?: string;
          created_at?: string;
          custom_label?: string | null;
          doc_date?: string | null;
          file_name: string;
          file_path: string;
          file_size: number;
          id?: string;
          label: string;
          mime_type?: string | null;
          notes?: string | null;
          sent_via?: string | null;
          status?: string | null;
          tracking_no?: string | null;
          updated_at?: string;
          uploaded_by?: string | null;
          uploaded_by_name?: string | null;
        };
        Update: {
          booking_id?: string;
          company_id?: string;
          created_at?: string;
          custom_label?: string | null;
          doc_date?: string | null;
          file_name?: string;
          file_path?: string;
          file_size?: number;
          id?: string;
          label?: string;
          mime_type?: string | null;
          notes?: string | null;
          sent_via?: string | null;
          status?: string | null;
          tracking_no?: string | null;
          updated_at?: string;
          uploaded_by?: string | null;
          uploaded_by_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_documents_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "booking_documents_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "booking_documents_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "booking_documents_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          address: string | null;
          adjustment_credit: number | null;
          assigned_to: string | null;
          base_rate: number | null;
          booking_date: string | null;
          booking_id: string;
          booking_status: string | null;
          cash_received: number | null;
          client_name: string | null;
          client_ref: string | null;
          cnic: string | null;
          company_id: string;
          created_at: string;
          current_overdue_count: number | null;
          dealer_commission_amount: number | null;
          dealer_commission_fixed: number | null;
          dealer_commission_pct: number | null;
          dealer_name: string | null;
          down_payment: number | null;
          first_installment_due: string | null;
          floor: string | null;
          installment_amount: number | null;
          installment_frequency: string | null;
          latest_overdue_date: string | null;
          mobile: string | null;
          net_company_value: number | null;
          next_action: string | null;
          no_of_installments: number | null;
          notes: string | null;
          oldest_overdue_date: string | null;
          possession_amount: number | null;
          possession_due_date: string | null;
          price_loss: number | null;
          project_code: string | null;
          project_name: string | null;
          remaining_balance: number | null;
          risk_level: string | null;
          size_sqft: number | null;
          so_wo: string | null;
          sold_rate: number | null;
          sold_total_override: number | null;
          sold_unit_value: number | null;
          standard_value: number | null;
          tenant_id: string | null;
          total_contract_value: number | null;
          total_overdue_amount: number | null;
          unit_id: string | null;
          unit_type: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          adjustment_credit?: number | null;
          assigned_to?: string | null;
          base_rate?: number | null;
          booking_date?: string | null;
          booking_id: string;
          booking_status?: string | null;
          cash_received?: number | null;
          client_name?: string | null;
          client_ref?: string | null;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          current_overdue_count?: number | null;
          dealer_commission_amount?: number | null;
          dealer_commission_fixed?: number | null;
          dealer_commission_pct?: number | null;
          dealer_name?: string | null;
          down_payment?: number | null;
          first_installment_due?: string | null;
          floor?: string | null;
          installment_amount?: number | null;
          installment_frequency?: string | null;
          latest_overdue_date?: string | null;
          mobile?: string | null;
          net_company_value?: number | null;
          next_action?: string | null;
          no_of_installments?: number | null;
          notes?: string | null;
          oldest_overdue_date?: string | null;
          possession_amount?: number | null;
          possession_due_date?: string | null;
          price_loss?: number | null;
          project_code?: string | null;
          project_name?: string | null;
          remaining_balance?: number | null;
          risk_level?: string | null;
          size_sqft?: number | null;
          so_wo?: string | null;
          sold_rate?: number | null;
          sold_total_override?: number | null;
          sold_unit_value?: number | null;
          standard_value?: number | null;
          tenant_id?: string | null;
          total_contract_value?: number | null;
          total_overdue_amount?: number | null;
          unit_id?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          adjustment_credit?: number | null;
          assigned_to?: string | null;
          base_rate?: number | null;
          booking_date?: string | null;
          booking_id?: string;
          booking_status?: string | null;
          cash_received?: number | null;
          client_name?: string | null;
          client_ref?: string | null;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          current_overdue_count?: number | null;
          dealer_commission_amount?: number | null;
          dealer_commission_fixed?: number | null;
          dealer_commission_pct?: number | null;
          dealer_name?: string | null;
          down_payment?: number | null;
          first_installment_due?: string | null;
          floor?: string | null;
          installment_amount?: number | null;
          installment_frequency?: string | null;
          latest_overdue_date?: string | null;
          mobile?: string | null;
          net_company_value?: number | null;
          next_action?: string | null;
          no_of_installments?: number | null;
          notes?: string | null;
          oldest_overdue_date?: string | null;
          possession_amount?: number | null;
          possession_due_date?: string | null;
          price_loss?: number | null;
          project_code?: string | null;
          project_name?: string | null;
          remaining_balance?: number | null;
          risk_level?: string | null;
          size_sqft?: number | null;
          so_wo?: string | null;
          sold_rate?: number | null;
          sold_total_override?: number | null;
          sold_unit_value?: number | null;
          standard_value?: number | null;
          tenant_id?: string | null;
          total_contract_value?: number | null;
          total_overdue_amount?: number | null;
          unit_id?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_client_ref_fkey";
            columns: ["client_ref"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["client_ref"];
          },
          {
            foreignKeyName: "bookings_client_ref_fkey";
            columns: ["client_ref"];
            isOneToOne: false;
            referencedRelation: "clients_public";
            referencedColumns: ["client_ref"];
          },
          {
            foreignKeyName: "bookings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_project_code_fkey";
            columns: ["project_code"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
          {
            foreignKeyName: "bookings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["unit_id"];
          },
        ];
      };
      clients: {
        Row: {
          address: string | null;
          client_ref: string;
          cnic: string | null;
          company_id: string;
          created_at: string;
          mobile: string | null;
          name: string;
          so_wo: string | null;
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          client_ref: string;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          mobile?: string | null;
          name: string;
          so_wo?: string | null;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          client_ref?: string;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          mobile?: string | null;
          name?: string;
          so_wo?: string | null;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clients_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          address: string | null;
          approval_status: string;
          approved_at: string | null;
          approved_by: string | null;
          city: string | null;
          created_at: string;
          currency: string;
          default_project_code: string | null;
          email: string | null;
          financial_year_start: number;
          id: string;
          is_active: boolean;
          logo_url: string | null;
          name: string;
          onboarding_completed_at: string | null;
          phone: string | null;
          plan: Database["public"]["Enums"]["company_plan"];
          rejection_reason: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          city?: string | null;
          created_at?: string;
          currency?: string;
          default_project_code?: string | null;
          email?: string | null;
          financial_year_start?: number;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name: string;
          onboarding_completed_at?: string | null;
          phone?: string | null;
          plan?: Database["public"]["Enums"]["company_plan"];
          rejection_reason?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          approval_status?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          city?: string | null;
          created_at?: string;
          currency?: string;
          default_project_code?: string | null;
          email?: string | null;
          financial_year_start?: number;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name?: string;
          onboarding_completed_at?: string | null;
          phone?: string | null;
          plan?: Database["public"]["Enums"]["company_plan"];
          rejection_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      company_invitations: {
        Row: {
          accepted_at: string | null;
          company_id: string;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["app_role"];
          token: string;
        };
        Insert: {
          accepted_at?: string | null;
          company_id: string;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role: Database["public"]["Enums"]["app_role"];
          token?: string;
        };
        Update: {
          accepted_at?: string | null;
          company_id?: string;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "company_invitations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      construction_costs: {
        Row: {
          amount: number;
          amount_paid: number;
          category: string;
          company_id: string;
          cost_date: string;
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          party_name: string | null;
          party_type: string;
          payment_mode: string | null;
          project_code: string;
          quantity: number | null;
          rate: number | null;
          reference_no: string | null;
          unit: string | null;
          updated_at: string;
          work_description: string;
        };
        Insert: {
          amount: number;
          amount_paid?: number;
          category: string;
          company_id?: string;
          cost_date: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          party_name?: string | null;
          party_type?: string;
          payment_mode?: string | null;
          project_code: string;
          quantity?: number | null;
          rate?: number | null;
          reference_no?: string | null;
          unit?: string | null;
          updated_at?: string;
          work_description: string;
        };
        Update: {
          amount?: number;
          amount_paid?: number;
          category?: string;
          company_id?: string;
          cost_date?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          party_name?: string | null;
          party_type?: string;
          payment_mode?: string | null;
          project_code?: string;
          quantity?: number | null;
          rate?: number | null;
          reference_no?: string | null;
          unit?: string | null;
          updated_at?: string;
          work_description?: string;
        };
        Relationships: [
          {
            foreignKeyName: "construction_costs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "construction_costs_project_code_fkey";
            columns: ["project_code"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
        ];
      };
      construction_project_budgets: {
        Row: {
          approved_budget: number;
          company_id: string;
          created_at: string;
          notes: string | null;
          progress_percent: number;
          project_code: string;
          updated_at: string;
        };
        Insert: {
          approved_budget?: number;
          company_id?: string;
          created_at?: string;
          notes?: string | null;
          progress_percent?: number;
          project_code: string;
          updated_at?: string;
        };
        Update: {
          approved_budget?: number;
          company_id?: string;
          created_at?: string;
          notes?: string | null;
          progress_percent?: number;
          project_code?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "construction_project_budgets_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "construction_project_budgets_project_code_fkey";
            columns: ["project_code"];
            isOneToOne: true;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
        ];
      };
      crm_leads: {
        Row: {
          assigned_to: string | null;
          budget_max: number | null;
          budget_min: number | null;
          cnic: string | null;
          company_id: string;
          converted_booking_id: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          follow_up_date: string | null;
          full_name: string;
          id: string;
          interested_project_code: string | null;
          interested_unit_type: string | null;
          mobile: string;
          notes: string | null;
          source: string;
          stage: string;
          stage_entered_at: string;
          updated_at: string;
          whatsapp: string | null;
        };
        Insert: {
          assigned_to?: string | null;
          budget_max?: number | null;
          budget_min?: number | null;
          cnic?: string | null;
          company_id?: string;
          converted_booking_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          follow_up_date?: string | null;
          full_name: string;
          id?: string;
          interested_project_code?: string | null;
          interested_unit_type?: string | null;
          mobile: string;
          notes?: string | null;
          source?: string;
          stage?: string;
          stage_entered_at?: string;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Update: {
          assigned_to?: string | null;
          budget_max?: number | null;
          budget_min?: number | null;
          cnic?: string | null;
          company_id?: string;
          converted_booking_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          follow_up_date?: string | null;
          full_name?: string;
          id?: string;
          interested_project_code?: string | null;
          interested_unit_type?: string | null;
          mobile?: string;
          notes?: string | null;
          source?: string;
          stage?: string;
          stage_entered_at?: string;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_leads_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      dealers: {
        Row: {
          company_id: string;
          created_at: string;
          name: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          name: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dealers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      erp_action_log: {
        Row: {
          after_state: Json | null;
          args: Json;
          before_state: Json | null;
          company_id: string;
          executed_at: string;
          id: string;
          rollback_by: string | null;
          rollback_reason: string | null;
          rolled_back_at: string | null;
          target_id: string;
          target_kind: string;
          tool_name: string;
          user_id: string;
        };
        Insert: {
          after_state?: Json | null;
          args?: Json;
          before_state?: Json | null;
          company_id?: string;
          executed_at?: string;
          id?: string;
          rollback_by?: string | null;
          rollback_reason?: string | null;
          rolled_back_at?: string | null;
          target_id: string;
          target_kind: string;
          tool_name: string;
          user_id: string;
        };
        Update: {
          after_state?: Json | null;
          args?: Json;
          before_state?: Json | null;
          company_id?: string;
          executed_at?: string;
          id?: string;
          rollback_by?: string | null;
          rollback_reason?: string | null;
          rolled_back_at?: string | null;
          target_id?: string;
          target_kind?: string;
          tool_name?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "erp_action_log_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      hr_attendance: {
        Row: {
          attendance_date: string;
          check_in: string | null;
          check_out: string | null;
          company_id: string;
          created_at: string;
          employee_id: string;
          id: string;
          notes: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attendance_date: string;
          check_in?: string | null;
          check_out?: string | null;
          company_id?: string;
          created_at?: string;
          employee_id: string;
          id?: string;
          notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attendance_date?: string;
          check_in?: string | null;
          check_out?: string | null;
          company_id?: string;
          created_at?: string;
          employee_id?: string;
          id?: string;
          notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hr_attendance_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hr_attendance_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "hr_employees";
            referencedColumns: ["id"];
          },
        ];
      };
      hr_employees: {
        Row: {
          address: string | null;
          allowances: number;
          bank_account: string | null;
          bank_name: string | null;
          basic_salary: number;
          cnic: string | null;
          company_id: string;
          created_at: string;
          department: string;
          designation: string | null;
          emergency_contact: string | null;
          emergency_mobile: string | null;
          employee_id: string;
          father_name: string | null;
          full_name: string;
          id: string;
          join_date: string | null;
          mobile: string | null;
          photo_path: string | null;
          status: string;
          total_salary: number;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          allowances?: number;
          bank_account?: string | null;
          bank_name?: string | null;
          basic_salary?: number;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          department: string;
          designation?: string | null;
          emergency_contact?: string | null;
          emergency_mobile?: string | null;
          employee_id: string;
          father_name?: string | null;
          full_name: string;
          id?: string;
          join_date?: string | null;
          mobile?: string | null;
          photo_path?: string | null;
          status?: string;
          total_salary?: number;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          allowances?: number;
          bank_account?: string | null;
          bank_name?: string | null;
          basic_salary?: number;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          department?: string;
          designation?: string | null;
          emergency_contact?: string | null;
          emergency_mobile?: string | null;
          employee_id?: string;
          father_name?: string | null;
          full_name?: string;
          id?: string;
          join_date?: string | null;
          mobile?: string | null;
          photo_path?: string | null;
          status?: string;
          total_salary?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hr_employees_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      hr_final_settlements: {
        Row: {
          allowances: number;
          basic_salary: number;
          bonus: number;
          company_id: string;
          created_at: string;
          deductions: number;
          employee_id: string;
          gratuity: number;
          id: string;
          last_working_date: string | null;
          leave_encashment: number;
          net_payable: number;
          notes: string | null;
          other_additions: number;
          reason: string;
          settlement_date: string;
          status: string;
          unpaid_salary: number;
          updated_at: string;
          years_of_service: number;
        };
        Insert: {
          allowances?: number;
          basic_salary?: number;
          bonus?: number;
          company_id?: string;
          created_at?: string;
          deductions?: number;
          employee_id: string;
          gratuity?: number;
          id?: string;
          last_working_date?: string | null;
          leave_encashment?: number;
          net_payable?: number;
          notes?: string | null;
          other_additions?: number;
          reason: string;
          settlement_date?: string;
          status?: string;
          unpaid_salary?: number;
          updated_at?: string;
          years_of_service?: number;
        };
        Update: {
          allowances?: number;
          basic_salary?: number;
          bonus?: number;
          company_id?: string;
          created_at?: string;
          deductions?: number;
          employee_id?: string;
          gratuity?: number;
          id?: string;
          last_working_date?: string | null;
          leave_encashment?: number;
          net_payable?: number;
          notes?: string | null;
          other_additions?: number;
          reason?: string;
          settlement_date?: string;
          status?: string;
          unpaid_salary?: number;
          updated_at?: string;
          years_of_service?: number;
        };
        Relationships: [
          {
            foreignKeyName: "hr_final_settlements_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hr_final_settlements_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: true;
            referencedRelation: "hr_employees";
            referencedColumns: ["id"];
          },
        ];
      };
      hr_payroll_runs: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          period_month: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          period_month: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          period_month?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hr_payroll_runs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      hr_payslips: {
        Row: {
          absent_days: number;
          allowances: number;
          basic_salary: number;
          company_id: string;
          created_at: string;
          deduction: number;
          employee_id: string;
          gross_salary: number;
          half_days: number;
          id: string;
          late_days: number;
          leave_days: number;
          net_salary: number;
          notes: string | null;
          paid_at: string | null;
          present_days: number;
          run_id: string;
          updated_at: string;
          working_days: number;
        };
        Insert: {
          absent_days?: number;
          allowances?: number;
          basic_salary?: number;
          company_id?: string;
          created_at?: string;
          deduction?: number;
          employee_id: string;
          gross_salary?: number;
          half_days?: number;
          id?: string;
          late_days?: number;
          leave_days?: number;
          net_salary?: number;
          notes?: string | null;
          paid_at?: string | null;
          present_days?: number;
          run_id: string;
          updated_at?: string;
          working_days?: number;
        };
        Update: {
          absent_days?: number;
          allowances?: number;
          basic_salary?: number;
          company_id?: string;
          created_at?: string;
          deduction?: number;
          employee_id?: string;
          gross_salary?: number;
          half_days?: number;
          id?: string;
          late_days?: number;
          leave_days?: number;
          net_salary?: number;
          notes?: string | null;
          paid_at?: string | null;
          present_days?: number;
          run_id?: string;
          updated_at?: string;
          working_days?: number;
        };
        Relationships: [
          {
            foreignKeyName: "hr_payslips_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hr_payslips_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "hr_employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hr_payslips_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "hr_payroll_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      import_validation_audit: {
        Row: {
          actor_email: string | null;
          clean_rows: number;
          company_id: string;
          created_at: string;
          created_by: string | null;
          file_hash: string | null;
          file_name: string;
          file_size: number | null;
          file_version: string | null;
          id: string;
          input_rows: number;
          notes: string | null;
          per_sheet: Json;
          quarantined_rows: number;
          report_path: string | null;
          rule_breakdown: Json;
          sheets_validated: number;
          workbook_content_type: string | null;
          workbook_path: string | null;
        };
        Insert: {
          actor_email?: string | null;
          clean_rows?: number;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          file_hash?: string | null;
          file_name: string;
          file_size?: number | null;
          file_version?: string | null;
          id?: string;
          input_rows?: number;
          notes?: string | null;
          per_sheet?: Json;
          quarantined_rows?: number;
          report_path?: string | null;
          rule_breakdown?: Json;
          sheets_validated?: number;
          workbook_content_type?: string | null;
          workbook_path?: string | null;
        };
        Update: {
          actor_email?: string | null;
          clean_rows?: number;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          file_hash?: string | null;
          file_name?: string;
          file_size?: number | null;
          file_version?: string | null;
          id?: string;
          input_rows?: number;
          notes?: string | null;
          per_sheet?: Json;
          quarantined_rows?: number;
          report_path?: string | null;
          rule_breakdown?: Json;
          sheets_validated?: number;
          workbook_content_type?: string | null;
          workbook_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "import_validation_audit_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      installment_ledger: {
        Row: {
          aging_level: string | null;
          booking_id: string;
          client_name: string | null;
          company_id: string;
          created_at: string;
          days_overdue: number | null;
          due_amount: number | null;
          due_date: string | null;
          ledger_id: string;
          next_action: string | null;
          paid_amount: number | null;
          paid_date: string | null;
          particulars: string | null;
          project: string | null;
          running_balance: number | null;
          status: string | null;
          term_no: number | null;
          unit_no: string | null;
          updated_at: string;
        };
        Insert: {
          aging_level?: string | null;
          booking_id: string;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          days_overdue?: number | null;
          due_amount?: number | null;
          due_date?: string | null;
          ledger_id: string;
          next_action?: string | null;
          paid_amount?: number | null;
          paid_date?: string | null;
          particulars?: string | null;
          project?: string | null;
          running_balance?: number | null;
          status?: string | null;
          term_no?: number | null;
          unit_no?: string | null;
          updated_at?: string;
        };
        Update: {
          aging_level?: string | null;
          booking_id?: string;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          days_overdue?: number | null;
          due_amount?: number | null;
          due_date?: string | null;
          ledger_id?: string;
          next_action?: string | null;
          paid_amount?: number | null;
          paid_date?: string | null;
          particulars?: string | null;
          project?: string | null;
          running_balance?: number | null;
          status?: string | null;
          term_no?: number | null;
          unit_no?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "installment_ledger_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "installment_ledger_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "installment_ledger_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "installment_ledger_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_transactions: {
        Row: {
          booking_id: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          credit: number;
          debit: number;
          description: string | null;
          id: string;
          meta: Json;
          posted_at: string;
          reference_id: string | null;
          reference_type: string | null;
          txn_date: string;
          txn_type: string;
          voucher_no: string | null;
        };
        Insert: {
          booking_id?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          credit?: number;
          debit?: number;
          description?: string | null;
          id?: string;
          meta?: Json;
          posted_at?: string;
          reference_id?: string | null;
          reference_type?: string | null;
          txn_date: string;
          txn_type: string;
          voucher_no?: string | null;
        };
        Update: {
          booking_id?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          credit?: number;
          debit?: number;
          description?: string | null;
          id?: string;
          meta?: Json;
          posted_at?: string;
          reference_id?: string | null;
          reference_type?: string | null;
          txn_date?: string;
          txn_type?: string;
          voucher_no?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      maintenance_charges: {
        Row: {
          amount_due: number;
          balance: number;
          booking_id: string | null;
          charge_id: string;
          charge_name: string;
          client_name: string | null;
          company_id: string;
          created_at: string;
          due_date: string;
          id: string;
          late_fee: number;
          notes: string | null;
          paid_amount: number;
          paid_date: string | null;
          period: string;
          period_start: string;
          project_code: string;
          project_name: string | null;
          schedule_id: string;
          status: string;
          total_due: number;
          unit_id: string;
          updated_at: string;
          waived: boolean;
          waived_at: string | null;
          waived_by: string | null;
          waived_reason: string | null;
        };
        Insert: {
          amount_due?: number;
          balance?: number;
          booking_id?: string | null;
          charge_id?: string;
          charge_name: string;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          due_date: string;
          id?: string;
          late_fee?: number;
          notes?: string | null;
          paid_amount?: number;
          paid_date?: string | null;
          period: string;
          period_start: string;
          project_code: string;
          project_name?: string | null;
          schedule_id: string;
          status?: string;
          total_due?: number;
          unit_id: string;
          updated_at?: string;
          waived?: boolean;
          waived_at?: string | null;
          waived_by?: string | null;
          waived_reason?: string | null;
        };
        Update: {
          amount_due?: number;
          balance?: number;
          booking_id?: string | null;
          charge_id?: string;
          charge_name?: string;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          due_date?: string;
          id?: string;
          late_fee?: number;
          notes?: string | null;
          paid_amount?: number;
          paid_date?: string | null;
          period?: string;
          period_start?: string;
          project_code?: string;
          project_name?: string | null;
          schedule_id?: string;
          status?: string;
          total_due?: number;
          unit_id?: string;
          updated_at?: string;
          waived?: boolean;
          waived_at?: string | null;
          waived_by?: string | null;
          waived_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "maintenance_charges_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "maintenance_charges_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "maintenance_charges_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "maintenance_charges_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_charges_schedule_id_fkey";
            columns: ["schedule_id"];
            isOneToOne: false;
            referencedRelation: "maintenance_schedules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_charges_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["unit_id"];
          },
        ];
      };
      maintenance_expenses: {
        Row: {
          amount: number;
          category: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          date: string;
          description: string | null;
          expense_no: string;
          id: string;
          notes: string | null;
          paid_by: string | null;
          project_code: string | null;
          reference_no: string | null;
          updated_at: string;
          vendor: string | null;
        };
        Insert: {
          amount: number;
          category: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          date?: string;
          description?: string | null;
          expense_no?: string;
          id?: string;
          notes?: string | null;
          paid_by?: string | null;
          project_code?: string | null;
          reference_no?: string | null;
          updated_at?: string;
          vendor?: string | null;
        };
        Update: {
          amount?: number;
          category?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          date?: string;
          description?: string | null;
          expense_no?: string;
          id?: string;
          notes?: string | null;
          paid_by?: string | null;
          project_code?: string | null;
          reference_no?: string | null;
          updated_at?: string;
          vendor?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "maintenance_expenses_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_expenses_project_code_fkey";
            columns: ["project_code"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
        ];
      };
      maintenance_payments: {
        Row: {
          amount_paid: number;
          charge_id: string;
          client_name: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          late_fee_waived: boolean;
          notes: string | null;
          payment_date: string;
          payment_mode: string;
          receipt_no: string;
          received_by: string | null;
          reference_no: string | null;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          amount_paid: number;
          charge_id: string;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          late_fee_waived?: boolean;
          notes?: string | null;
          payment_date?: string;
          payment_mode: string;
          receipt_no?: string;
          received_by?: string | null;
          reference_no?: string | null;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          amount_paid?: number;
          charge_id?: string;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          late_fee_waived?: boolean;
          notes?: string | null;
          payment_date?: string;
          payment_mode?: string;
          receipt_no?: string;
          received_by?: string | null;
          reference_no?: string | null;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "maintenance_payments_charge_id_fkey";
            columns: ["charge_id"];
            isOneToOne: false;
            referencedRelation: "maintenance_charges";
            referencedColumns: ["charge_id"];
          },
          {
            foreignKeyName: "maintenance_payments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      maintenance_schedules: {
        Row: {
          amount_per_sqft: number | null;
          applicable_to: string;
          charge_name: string;
          charge_type: string;
          company_id: string;
          created_at: string;
          custom_unit_ids: string[];
          due_day: number | null;
          effective_from: string;
          fixed_amount: number | null;
          grace_period_days: number;
          id: string;
          is_active: boolean;
          late_fee: number;
          notes: string | null;
          project_code: string;
          updated_at: string;
        };
        Insert: {
          amount_per_sqft?: number | null;
          applicable_to?: string;
          charge_name: string;
          charge_type: string;
          company_id?: string;
          created_at?: string;
          custom_unit_ids?: string[];
          due_day?: number | null;
          effective_from: string;
          fixed_amount?: number | null;
          grace_period_days?: number;
          id?: string;
          is_active?: boolean;
          late_fee?: number;
          notes?: string | null;
          project_code: string;
          updated_at?: string;
        };
        Update: {
          amount_per_sqft?: number | null;
          applicable_to?: string;
          charge_name?: string;
          charge_type?: string;
          company_id?: string;
          created_at?: string;
          custom_unit_ids?: string[];
          due_day?: number | null;
          effective_from?: string;
          fixed_amount?: number | null;
          grace_period_days?: number;
          id?: string;
          is_active?: boolean;
          late_fee?: number;
          notes?: string | null;
          project_code?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "maintenance_schedules_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maintenance_schedules_project_code_fkey";
            columns: ["project_code"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
        ];
      };
      marketing_controls: {
        Row: {
          created_at: string;
          is_enabled: boolean;
          metadata: Json;
          section_key: string;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          is_enabled?: boolean;
          metadata?: Json;
          section_key: string;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          is_enabled?: boolean;
          metadata?: Json;
          section_key?: string;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      marketing_controls_history: {
        Row: {
          changed_by: string | null;
          created_at: string | null;
          id: string;
          is_enabled: boolean;
          metadata: Json | null;
          section_key: string;
        };
        Insert: {
          changed_by?: string | null;
          created_at?: string | null;
          id?: string;
          is_enabled: boolean;
          metadata?: Json | null;
          section_key: string;
        };
        Update: {
          changed_by?: string | null;
          created_at?: string | null;
          id?: string;
          is_enabled?: boolean;
          metadata?: Json | null;
          section_key?: string;
        };
        Relationships: [];
      };
      office_expenses: {
        Row: {
          amount: number;
          category: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          description: string;
          expense_date: string;
          id: string;
          notes: string | null;
          paid_by: string;
          paid_to: string | null;
          project_code: string | null;
          receipt_attachment_path: string | null;
          receipt_ref: string | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          category: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          description: string;
          expense_date?: string;
          id?: string;
          notes?: string | null;
          paid_by: string;
          paid_to?: string | null;
          project_code?: string | null;
          receipt_attachment_path?: string | null;
          receipt_ref?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          expense_date?: string;
          id?: string;
          notes?: string | null;
          paid_by?: string;
          paid_to?: string | null;
          project_code?: string | null;
          receipt_attachment_path?: string | null;
          receipt_ref?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "office_expenses_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_allocations: {
        Row: {
          amount: number;
          company_id: string;
          created_at: string;
          created_by: string | null;
          head_label: string | null;
          id: string;
          ledger_id: string;
          receipt_no: string;
        };
        Insert: {
          amount: number;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          head_label?: string | null;
          id?: string;
          ledger_id: string;
          receipt_no: string;
        };
        Update: {
          amount?: number;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          head_label?: string | null;
          id?: string;
          ledger_id?: string;
          receipt_no?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_allocations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_allocations_ledger_id_fkey";
            columns: ["ledger_id"];
            isOneToOne: false;
            referencedRelation: "installment_ledger";
            referencedColumns: ["ledger_id"];
          },
          {
            foreignKeyName: "payment_allocations_receipt_no_fkey";
            columns: ["receipt_no"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["receipt_no"];
          },
          {
            foreignKeyName: "payment_allocations_receipt_no_fkey";
            columns: ["receipt_no"];
            isOneToOne: false;
            referencedRelation: "payments_public";
            referencedColumns: ["receipt_no"];
          },
        ];
      };
      payment_comments: {
        Row: {
          body: string;
          booking_id: string | null;
          client_name: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
          payment_receipt_no: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          source: string;
          status: string;
        };
        Insert: {
          body: string;
          booking_id?: string | null;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          payment_receipt_no?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          source?: string;
          status?: string;
        };
        Update: {
          body?: string;
          booking_id?: string | null;
          client_name?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          payment_receipt_no?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          source?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_comments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_edit_history: {
        Row: {
          booking_id: string | null;
          company_id: string;
          edited_at: string;
          edited_by: string;
          field_changed: string;
          id: string;
          new_value: string | null;
          old_value: string | null;
          reason: string;
          receipt_no: string;
        };
        Insert: {
          booking_id?: string | null;
          company_id?: string;
          edited_at?: string;
          edited_by?: string;
          field_changed: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
          reason: string;
          receipt_no: string;
        };
        Update: {
          booking_id?: string | null;
          company_id?: string;
          edited_at?: string;
          edited_by?: string;
          field_changed?: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
          reason?: string;
          receipt_no?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_edit_history_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          account: string | null;
          amount: number;
          booking_id: string | null;
          cash_bank_include: boolean | null;
          cheque_txn_no: string | null;
          client_name: string | null;
          cnic: string | null;
          company_id: string;
          created_at: string;
          memo: string | null;
          non_cash_adjustment: boolean | null;
          payment_date: string | null;
          payment_head: string | null;
          payment_mode: string | null;
          posted_by: string | null;
          project: string | null;
          public_note_token: string | null;
          receipt_no: string;
          received_from: string | null;
          remarks: string | null;
          safe_cash_amount: number | null;
          status: string | null;
          unit_no: string | null;
          updated_at: string;
        };
        Insert: {
          account?: string | null;
          amount: number;
          booking_id?: string | null;
          cash_bank_include?: boolean | null;
          cheque_txn_no?: string | null;
          client_name?: string | null;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          memo?: string | null;
          non_cash_adjustment?: boolean | null;
          payment_date?: string | null;
          payment_head?: string | null;
          payment_mode?: string | null;
          posted_by?: string | null;
          project?: string | null;
          public_note_token?: string | null;
          receipt_no: string;
          received_from?: string | null;
          remarks?: string | null;
          safe_cash_amount?: number | null;
          status?: string | null;
          unit_no?: string | null;
          updated_at?: string;
        };
        Update: {
          account?: string | null;
          amount?: number;
          booking_id?: string | null;
          cash_bank_include?: boolean | null;
          cheque_txn_no?: string | null;
          client_name?: string | null;
          cnic?: string | null;
          company_id?: string;
          created_at?: string;
          memo?: string | null;
          non_cash_adjustment?: boolean | null;
          payment_date?: string | null;
          payment_head?: string | null;
          payment_mode?: string | null;
          posted_by?: string | null;
          project?: string | null;
          public_note_token?: string | null;
          receipt_no?: string;
          received_from?: string | null;
          remarks?: string | null;
          safe_cash_amount?: number | null;
          status?: string | null;
          unit_no?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "payments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_restructure_history: {
        Row: {
          after: Json;
          before: Json;
          booking_id: string;
          company_id: string;
          id: string;
          reason: string;
          restructured_at: string;
          restructured_by: string;
        };
        Insert: {
          after: Json;
          before: Json;
          booking_id: string;
          company_id?: string;
          id?: string;
          reason: string;
          restructured_at?: string;
          restructured_by?: string;
        };
        Update: {
          after?: Json;
          before?: Json;
          booking_id?: string;
          company_id?: string;
          id?: string;
          reason?: string;
          restructured_at?: string;
          restructured_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_restructure_history_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          active_project_code: string | null;
          company_id: string;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          is_active: boolean;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          active_project_code?: string | null;
          company_id: string;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          active_project_code?: string | null;
          company_id?: string;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_active_project_code_fkey";
            columns: ["active_project_code"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
          {
            foreignKeyName: "profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      project_document_branding: {
        Row: {
          accent_token: string;
          address_line: string | null;
          company_id: string;
          created_at: string;
          cui: string | null;
          email: string | null;
          footer_note: string | null;
          header_logo_url: string | null;
          id: string;
          legal_entity: string | null;
          ntn: string | null;
          phone_strip: string | null;
          project_code: string;
          project_display_name: string | null;
          tagline: string | null;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          accent_token?: string;
          address_line?: string | null;
          company_id: string;
          created_at?: string;
          cui?: string | null;
          email?: string | null;
          footer_note?: string | null;
          header_logo_url?: string | null;
          id?: string;
          legal_entity?: string | null;
          ntn?: string | null;
          phone_strip?: string | null;
          project_code: string;
          project_display_name?: string | null;
          tagline?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          accent_token?: string;
          address_line?: string | null;
          company_id?: string;
          created_at?: string;
          cui?: string | null;
          email?: string | null;
          footer_note?: string | null;
          header_logo_url?: string | null;
          id?: string;
          legal_entity?: string | null;
          ntn?: string | null;
          phone_strip?: string | null;
          project_code?: string;
          project_display_name?: string | null;
          tagline?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          company_id: string;
          created_at: string;
          display_name: string | null;
          expected_completion_date: string | null;
          location: string | null;
          notes: string | null;
          project_code: string;
          project_name: string;
          project_type: string | null;
          start_date: string | null;
          status: string | null;
          updated_at: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          display_name?: string | null;
          expected_completion_date?: string | null;
          location?: string | null;
          notes?: string | null;
          project_code: string;
          project_name: string;
          project_type?: string | null;
          start_date?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          display_name?: string | null;
          expected_completion_date?: string | null;
          location?: string | null;
          notes?: string | null;
          project_code?: string;
          project_name?: string;
          project_type?: string | null;
          start_date?: string | null;
          status?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      properties: {
        Row: {
          address: string | null;
          company_id: string;
          created_at: string;
          id: string;
          name: string;
          notes: string | null;
          property_type: string | null;
          status: string | null;
          total_units: number | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          name: string;
          notes?: string | null;
          property_type?: string | null;
          status?: string | null;
          total_units?: number | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          company_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          property_type?: string | null;
          status?: string | null;
          total_units?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "properties_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          company_id: string | null;
          created_at: string;
          endpoint: string;
          id: string;
          last_used_at: string | null;
          p256dh: string;
          updated_at: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          auth: string;
          company_id?: string | null;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_used_at?: string | null;
          p256dh: string;
          updated_at?: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          company_id?: string | null;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_used_at?: string | null;
          p256dh?: string;
          updated_at?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      redirect_events: {
        Row: {
          company_id: string | null;
          from_path: string | null;
          id: string;
          is_admin: boolean | null;
          meta: Json;
          occurred_at: string;
          onboarding_completed: boolean | null;
          plan: string | null;
          reason: string;
          session_present: boolean | null;
          to_path: string | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          company_id?: string | null;
          from_path?: string | null;
          id?: string;
          is_admin?: boolean | null;
          meta?: Json;
          occurred_at?: string;
          onboarding_completed?: boolean | null;
          plan?: string | null;
          reason: string;
          session_present?: boolean | null;
          to_path?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          company_id?: string | null;
          from_path?: string | null;
          id?: string;
          is_admin?: boolean | null;
          meta?: Json;
          occurred_at?: string;
          onboarding_completed?: boolean | null;
          plan?: string | null;
          reason?: string;
          session_present?: boolean | null;
          to_path?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      rpc_authorization_denied_log: {
        Row: {
          company_id: string | null;
          correlation_id: string | null;
          error_code: string | null;
          error_message: string | null;
          id: string;
          occurred_at: string;
          page_path: string | null;
          rpc_name: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          company_id?: string | null;
          correlation_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          occurred_at?: string;
          page_path?: string | null;
          rpc_name: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Update: {
          company_id?: string | null;
          correlation_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          id?: string;
          occurred_at?: string;
          page_path?: string | null;
          rpc_name?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      security_definer_audit_log: {
        Row: {
          args: Json | null;
          called_at: string;
          caller_company_id: string | null;
          caller_role: string | null;
          caller_user_id: string | null;
          error_message: string | null;
          function_name: string;
          id: number;
          is_super_admin: boolean | null;
          result: string | null;
          tenant_check: string | null;
          tenant_check_passed: boolean | null;
        };
        Insert: {
          args?: Json | null;
          called_at?: string;
          caller_company_id?: string | null;
          caller_role?: string | null;
          caller_user_id?: string | null;
          error_message?: string | null;
          function_name: string;
          id?: number;
          is_super_admin?: boolean | null;
          result?: string | null;
          tenant_check?: string | null;
          tenant_check_passed?: boolean | null;
        };
        Update: {
          args?: Json | null;
          called_at?: string;
          caller_company_id?: string | null;
          caller_role?: string | null;
          caller_user_id?: string | null;
          error_message?: string | null;
          function_name?: string;
          id?: number;
          is_super_admin?: boolean | null;
          result?: string | null;
          tenant_check?: string | null;
          tenant_check_passed?: boolean | null;
        };
        Relationships: [];
      };
      security_report_shares: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          expires_at: string;
          filters: Json;
          id: string;
          share_token: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          expires_at: string;
          filters?: Json;
          id?: string;
          share_token?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          expires_at?: string;
          filters?: Json;
          id?: string;
          share_token?: string | null;
        };
        Relationships: [];
      };
      settings_change_log: {
        Row: {
          changed_by: string | null;
          changed_by_email: string | null;
          company_id: string;
          created_at: string;
          entity_label: string;
          entity_type: string;
          field: string;
          id: string;
          new_value: string | null;
          old_value: string | null;
        };
        Insert: {
          changed_by?: string | null;
          changed_by_email?: string | null;
          company_id: string;
          created_at?: string;
          entity_label: string;
          entity_type: string;
          field: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
        };
        Update: {
          changed_by?: string | null;
          changed_by_email?: string | null;
          company_id?: string;
          created_at?: string;
          entity_label?: string;
          entity_type?: string;
          field?: string;
          id?: string;
          new_value?: string | null;
          old_value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "settings_change_log_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      ssr_alert_config: {
        Row: {
          cooldown_minutes: number;
          id: boolean;
          last_alerted_at: string | null;
          threshold_per_5min: number;
          updated_at: string;
        };
        Insert: {
          cooldown_minutes?: number;
          id?: boolean;
          last_alerted_at?: string | null;
          threshold_per_5min?: number;
          updated_at?: string;
        };
        Update: {
          cooldown_minutes?: number;
          id?: boolean;
          last_alerted_at?: string | null;
          threshold_per_5min?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      ssr_error_events: {
        Row: {
          error_id: string | null;
          id: string;
          kind: string;
          message: string | null;
          method: string | null;
          occurred_at: string;
          path: string | null;
          user_agent: string | null;
        };
        Insert: {
          error_id?: string | null;
          id?: string;
          kind: string;
          message?: string | null;
          method?: string | null;
          occurred_at?: string;
          path?: string | null;
          user_agent?: string | null;
        };
        Update: {
          error_id?: string | null;
          id?: string;
          kind?: string;
          message?: string | null;
          method?: string | null;
          occurred_at?: string;
          path?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      super_admin_audit_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string;
          company_id: string | null;
          company_name: string | null;
          created_at: string;
          details: Json;
          id: string;
          target_user_email: string | null;
          target_user_id: string | null;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id: string;
          company_id?: string | null;
          company_name?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          target_user_email?: string | null;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string;
          company_id?: string | null;
          company_name?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          target_user_email?: string | null;
          target_user_id?: string | null;
        };
        Relationships: [];
      };
      super_admin_denial_alerts: {
        Row: {
          alert_type: string;
          created_at: string;
          denial_count: number;
          id: string;
          resolution_notes: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          sample_correlation_ids: string[];
          sample_rpc_names: string[];
          subject_id: string;
          subject_label: string | null;
          threshold: number;
          window_end: string;
          window_minutes: number;
          window_start: string;
        };
        Insert: {
          alert_type: string;
          created_at?: string;
          denial_count: number;
          id?: string;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          sample_correlation_ids?: string[];
          sample_rpc_names?: string[];
          subject_id: string;
          subject_label?: string | null;
          threshold: number;
          window_end: string;
          window_minutes: number;
          window_start: string;
        };
        Update: {
          alert_type?: string;
          created_at?: string;
          denial_count?: number;
          id?: string;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          sample_correlation_ids?: string[];
          sample_rpc_names?: string[];
          subject_id?: string;
          subject_label?: string | null;
          threshold?: number;
          window_end?: string;
          window_minutes?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      tenant_memberships: {
        Row: {
          created_at: string;
          id: string;
          role: string;
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_scope_logs: {
        Row: {
          company_id: string | null;
          duration_ms: number | null;
          fn_path: string | null;
          id: number;
          occurred_at: string;
          status: string;
          user_id: string | null;
        };
        Insert: {
          company_id?: string | null;
          duration_ms?: number | null;
          fn_path?: string | null;
          id?: number;
          occurred_at?: string;
          status: string;
          user_id?: string | null;
        };
        Update: {
          company_id?: string | null;
          duration_ms?: number | null;
          fn_path?: string | null;
          id?: number;
          occurred_at?: string;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          approval_status: string | null;
          created_at: string;
          id: string;
          is_active: boolean | null;
          logo_url: string | null;
          name: string;
          plan: string | null;
          slug: string;
        };
        Insert: {
          approval_status?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean | null;
          logo_url?: string | null;
          name: string;
          plan?: string | null;
          slug: string;
        };
        Update: {
          approval_status?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean | null;
          logo_url?: string | null;
          name?: string;
          plan?: string | null;
          slug?: string;
        };
        Relationships: [];
      };
      units: {
        Row: {
          base_rate: number | null;
          booked_by: string | null;
          company_id: string;
          created_at: string;
          floor: string | null;
          linked_booking_id: string | null;
          notes: string | null;
          project_code: string;
          project_name: string | null;
          size_sqft: number | null;
          standard_value: number | null;
          status: string | null;
          tenant_id: string | null;
          unit_id: string;
          unit_no: string | null;
          unit_type: string | null;
          updated_at: string;
        };
        Insert: {
          base_rate?: number | null;
          booked_by?: string | null;
          company_id?: string;
          created_at?: string;
          floor?: string | null;
          linked_booking_id?: string | null;
          notes?: string | null;
          project_code: string;
          project_name?: string | null;
          size_sqft?: number | null;
          standard_value?: number | null;
          status?: string | null;
          tenant_id?: string | null;
          unit_id: string;
          unit_no?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Update: {
          base_rate?: number | null;
          booked_by?: string | null;
          company_id?: string;
          created_at?: string;
          floor?: string | null;
          linked_booking_id?: string | null;
          notes?: string | null;
          project_code?: string;
          project_name?: string | null;
          size_sqft?: number | null;
          standard_value?: number | null;
          status?: string | null;
          tenant_id?: string | null;
          unit_id?: string;
          unit_no?: string | null;
          unit_type?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "units_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "units_project_code_fkey";
            columns: ["project_code"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
          {
            foreignKeyName: "units_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_expenses: {
        Row: {
          amount: number;
          category: string;
          company_id: string;
          created_at: string;
          description: string | null;
          expense_date: string;
          id: string;
          payment_status: string | null;
          project_code: string | null;
          property_id: string | null;
          reference_no: string | null;
          updated_at: string;
          vendor_id: string;
        };
        Insert: {
          amount: number;
          category: string;
          company_id?: string;
          created_at?: string;
          description?: string | null;
          expense_date?: string;
          id?: string;
          payment_status?: string | null;
          project_code?: string | null;
          property_id?: string | null;
          reference_no?: string | null;
          updated_at?: string;
          vendor_id: string;
        };
        Update: {
          amount?: number;
          category?: string;
          company_id?: string;
          created_at?: string;
          description?: string | null;
          expense_date?: string;
          id?: string;
          payment_status?: string | null;
          project_code?: string | null;
          property_id?: string | null;
          reference_no?: string | null;
          updated_at?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_expenses_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_expenses_project_code_fkey";
            columns: ["project_code"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
          {
            foreignKeyName: "vendor_expenses_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_expenses_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_ledger: {
        Row: {
          company_id: string;
          created_at: string;
          credit: number | null;
          debit: number | null;
          description: string | null;
          id: string;
          reference_id: string | null;
          txn_date: string;
          txn_type: string;
          vendor_id: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          credit?: number | null;
          debit?: number | null;
          description?: string | null;
          id?: string;
          reference_id?: string | null;
          txn_date?: string;
          txn_type: string;
          vendor_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          credit?: number | null;
          debit?: number | null;
          description?: string | null;
          id?: string;
          reference_id?: string | null;
          txn_date?: string;
          txn_type?: string;
          vendor_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_ledger_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_ledger_vendor_id_fkey";
            columns: ["vendor_id"];
            isOneToOne: false;
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      vendors: {
        Row: {
          address: string | null;
          category: string | null;
          company_id: string;
          contact_person: string | null;
          created_at: string;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string | null;
          tax_id: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          category?: string | null;
          company_id?: string;
          contact_person?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          tax_id?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          category?: string | null;
          company_id?: string;
          contact_person?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          tax_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendors_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      bookings_public: {
        Row: {
          address_masked: string | null;
          booking_date: string | null;
          booking_id: string | null;
          booking_status: string | null;
          client_name_masked: string | null;
          client_ref: string | null;
          cnic_masked: string | null;
          created_at: string | null;
          current_overdue_count: number | null;
          floor: string | null;
          mobile_masked: string | null;
          oldest_overdue_date: string | null;
          project_code: string | null;
          project_name: string | null;
          remaining_balance: number | null;
          risk_level: string | null;
          size_sqft: number | null;
          total_contract_value: number | null;
          total_overdue_amount: number | null;
          unit_id: string | null;
          unit_type: string | null;
          updated_at: string | null;
        };
        Insert: {
          address_masked?: never;
          booking_date?: string | null;
          booking_id?: string | null;
          booking_status?: string | null;
          client_name_masked?: never;
          client_ref?: string | null;
          cnic_masked?: never;
          created_at?: string | null;
          current_overdue_count?: number | null;
          floor?: string | null;
          mobile_masked?: never;
          oldest_overdue_date?: string | null;
          project_code?: string | null;
          project_name?: string | null;
          remaining_balance?: number | null;
          risk_level?: string | null;
          size_sqft?: number | null;
          total_contract_value?: number | null;
          total_overdue_amount?: number | null;
          unit_id?: string | null;
          unit_type?: string | null;
          updated_at?: string | null;
        };
        Update: {
          address_masked?: never;
          booking_date?: string | null;
          booking_id?: string | null;
          booking_status?: string | null;
          client_name_masked?: never;
          client_ref?: string | null;
          cnic_masked?: never;
          created_at?: string | null;
          current_overdue_count?: number | null;
          floor?: string | null;
          mobile_masked?: never;
          oldest_overdue_date?: string | null;
          project_code?: string | null;
          project_name?: string | null;
          remaining_balance?: number | null;
          risk_level?: string | null;
          size_sqft?: number | null;
          total_contract_value?: number | null;
          total_overdue_amount?: number | null;
          unit_id?: string | null;
          unit_type?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_client_ref_fkey";
            columns: ["client_ref"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["client_ref"];
          },
          {
            foreignKeyName: "bookings_client_ref_fkey";
            columns: ["client_ref"];
            isOneToOne: false;
            referencedRelation: "clients_public";
            referencedColumns: ["client_ref"];
          },
          {
            foreignKeyName: "bookings_project_code_fkey";
            columns: ["project_code"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["project_code"];
          },
          {
            foreignKeyName: "bookings_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["unit_id"];
          },
        ];
      };
      clients_public: {
        Row: {
          address_masked: string | null;
          client_ref: string | null;
          cnic_masked: string | null;
          created_at: string | null;
          mobile_masked: string | null;
          name_masked: string | null;
          updated_at: string | null;
        };
        Insert: {
          address_masked?: never;
          client_ref?: string | null;
          cnic_masked?: never;
          created_at?: string | null;
          mobile_masked?: never;
          name_masked?: never;
          updated_at?: string | null;
        };
        Update: {
          address_masked?: never;
          client_ref?: string | null;
          cnic_masked?: never;
          created_at?: string | null;
          mobile_masked?: never;
          name_masked?: never;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      data_health_issues: {
        Row: {
          adjustment_credit: number | null;
          booking_id: string | null;
          cash_received: number | null;
          client_name: string | null;
          down_payment: number | null;
          future_marked_overdue: number | null;
          installment_amount: number | null;
          issues: string[] | null;
          no_of_installments: number | null;
          overdue_amt_live: number | null;
          past_due_not_flagged: number | null;
          plan_sum: number | null;
          possession_amount: number | null;
          total_balance_live: number | null;
          total_contract_value: number | null;
        };
        Relationships: [];
      };
      payments_public: {
        Row: {
          amount: number | null;
          booking_id: string | null;
          client_name_masked: string | null;
          cnic_masked: string | null;
          created_at: string | null;
          payment_date: string | null;
          payment_head: string | null;
          payment_mode: string | null;
          project: string | null;
          receipt_no: string | null;
          status: string | null;
          unit_no: string | null;
          updated_at: string | null;
        };
        Insert: {
          amount?: number | null;
          booking_id?: string | null;
          client_name_masked?: never;
          cnic_masked?: never;
          created_at?: string | null;
          payment_date?: string | null;
          payment_head?: string | null;
          payment_mode?: string | null;
          project?: string | null;
          receipt_no?: string | null;
          status?: string | null;
          unit_no?: string | null;
          updated_at?: string | null;
        };
        Update: {
          amount?: number | null;
          booking_id?: string | null;
          client_name_masked?: never;
          cnic_masked?: never;
          created_at?: string | null;
          payment_date?: string | null;
          payment_head?: string | null;
          payment_mode?: string | null;
          project?: string | null;
          receipt_no?: string | null;
          status?: string | null;
          unit_no?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
        ];
      };
      v_booking_ledger: {
        Row: {
          booking_id: string | null;
          company_id: string | null;
          created_at: string | null;
          created_by: string | null;
          credit: number | null;
          debit: number | null;
          description: string | null;
          id: string | null;
          meta: Json | null;
          posted_at: string | null;
          reference_id: string | null;
          reference_type: string | null;
          running_balance: number | null;
          txn_date: string | null;
          txn_type: string | null;
          voucher_no: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      v_booking_summary: {
        Row: {
          adjustment_credits: number | null;
          booking_id: string | null;
          company_id: string | null;
          installments_due: number | null;
          last_txn_date: string | null;
          maintenance_charged: number | null;
          maintenance_paid: number | null;
          outstanding_balance: number | null;
          payments_received: number | null;
          total_charges: number | null;
          total_credits: number | null;
          transaction_count: number | null;
          waivers: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings_public";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "data_health_issues";
            referencedColumns: ["booking_id"];
          },
          {
            foreignKeyName: "ledger_transactions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      _ledger_post: {
        Args: {
          _booking: string;
          _company: string;
          _credit: number;
          _date: string;
          _debit: number;
          _desc: string;
          _meta?: Json;
          _ref_id: string;
          _ref_type: string;
          _type: string;
          _voucher: string;
        };
        Returns: undefined;
      };
      active_project_code: { Args: { _uid: string }; Returns: string };
      admin_cleanup_test_tenant: {
        Args: { _company_id: string };
        Returns: Json;
      };
      admin_create_invitation: {
        Args: { _email: string; _role: Database["public"]["Enums"]["app_role"] };
        Returns: {
          expires_at: string;
          token: string;
        }[];
      };
      admin_deactivate_company:
        | { Args: { _company_id: string }; Returns: undefined }
        | { Args: { _reason: string }; Returns: undefined };
      admin_delete_payment:
        | { Args: { _payment_id: string }; Returns: undefined }
        | { Args: { _reason: string; _receipt_no: string }; Returns: Json };
      admin_edit_payment: {
        Args: {
          _allocations?: Json;
          _patch: Json;
          _reason: string;
          _receipt_no: string;
        };
        Returns: Json;
      };
      admin_list_users: {
        Args: never;
        Returns: {
          email: string;
          full_name: string;
          id: string;
          is_active: boolean;
          last_sign_in_at: string;
          role: Database["public"]["Enums"]["app_role"];
        }[];
      };
      admin_restructure_plan: {
        Args: {
          _booking_id: string;
          _new_schedule: Json;
          _plan_meta: Json;
          _reason: string;
        };
        Returns: Json;
      };
      admin_set_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"]; _user: string };
        Returns: undefined;
      };
      admin_set_user_active: {
        Args: { _active: boolean; _user: string };
        Returns: undefined;
      };
      admin_transfer_ownership: {
        Args: { _new_owner: string };
        Returns: undefined;
      };
      assert_admin_access: { Args: { _scope: string }; Returns: Json };
      booking_project_code: { Args: { _booking_id: string }; Returns: string };
      bootstrap_company:
        | {
            Args: {
              _company_name: string;
              _phone: string;
              _plan: Database["public"]["Enums"]["company_plan"];
            };
            Returns: string;
          }
        | { Args: { _name: string }; Returns: string };
      bootstrap_tenant: {
        Args: { _name: string; _plan: string; _slug: string };
        Returns: string;
      };
      check_slug_available: { Args: { _slug: string }; Returns: boolean };
      check_ssr_spike: { Args: never; Returns: Json };
      client_add_note_by_token: {
        Args: { _body: string; _client_name: string; _token: string };
        Returns: Json;
      };
      client_get_payment_by_token: { Args: { _token: string }; Returns: Json };
      count_rows_by_company: {
        Args: { _company_id: string; _table_name: string };
        Returns: number;
      };
      current_company_id: { Args: never; Returns: string };
      data_health_summary: { Args: never; Returns: Json };
      explain_ai_tool_call_log: {
        Args: {
          p_limit?: number;
          p_offset?: number;
          p_retry?: string;
          p_search?: string;
          p_sort_dir?: string;
          p_sort_key?: string;
          p_status?: string;
          p_tool_name?: string;
        };
        Returns: string[];
      };
      generate_maintenance_charges: {
        Args: { _schedule_id: string; _through: string };
        Returns: number;
      };
      get_ssr_error_stats: { Args: never; Returns: Json };
      get_system_date: { Args: never; Returns: string };
      has_any_role: { Args: { _uid: string }; Returns: boolean };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_role_in_company: {
        Args: {
          _company: string;
          _role: Database["public"]["Enums"]["app_role"];
          _uid: string;
        };
        Returns: boolean;
      };
      is_super_admin:
        | { Args: never; Returns: boolean }
        | { Args: { _user_id: string }; Returns: boolean };
      is_tenant_member: {
        Args: { _tid: string; _uid: string };
        Returns: boolean;
      };
      is_user_in_company: {
        Args: { _company_id: string; _target_user: string };
        Returns: boolean;
      };
      is_writer: { Args: { _uid: string }; Returns: boolean };
      is_writer_in_company: {
        Args: { _company: string; _uid: string };
        Returns: boolean;
      };
      list_admin_contacts: {
        Args: never;
        Returns: {
          email: string;
          full_name: string;
        }[];
      };
      log_admin_access_event: {
        Args: { _event_type: string; _metadata?: Json; _resource: string };
        Returns: string;
      };
      log_redirect_reason: {
        Args: {
          _from_path?: string;
          _meta?: Json;
          _reason: string;
          _to_path?: string;
        };
        Returns: string;
      };
      log_security_definer_call: {
        Args: {
          _args?: Json;
          _error_message?: string;
          _function_name: string;
          _result?: string;
          _tenant_check?: string;
          _tenant_check_passed?: boolean;
        };
        Returns: undefined;
      };
      log_security_review_access: {
        Args: { _event_type: string; _note?: string; _path?: string };
        Returns: string;
      };
      mark_onboarding_complete: { Args: never; Returns: undefined };
      mask_address: { Args: { v: string }; Returns: string };
      mask_cnic: { Args: { v: string }; Returns: string };
      mask_mobile: { Args: { v: string }; Returns: string };
      mask_name: { Args: { v: string }; Returns: string };
      next_adjustment_id: { Args: never; Returns: string };
      recalc_maintenance_charge: {
        Args: { _charge_id: string };
        Returns: undefined;
      };
      recalculate_ledger_for_booking: {
        Args: { _booking_id: string };
        Returns: undefined;
      };
      recalculate_ledger_for_booking_internal: {
        Args: { _booking_id: string };
        Returns: undefined;
      };
      recompute_all_bookings: { Args: never; Returns: number };
      reconcile_payment_allocations: {
        Args: {
          _allocations: Json;
          _amount: number;
          _booking_id: string;
          _receipt_no: string;
        };
        Returns: Json;
      };
      reload_schema_cache: { Args: never; Returns: undefined };
      reseed_demo_data: { Args: never; Returns: Json };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      waive_maintenance_charge: {
        Args: { _charge_id: string; _reason: string };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "owner" | "admin" | "manager" | "staff" | "viewer" | "super_admin";
      company_plan: "starter" | "professional" | "builder";
      tenant_role: "tenant_admin" | "agency_manager" | "agent" | "accountant";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "manager", "staff", "viewer", "super_admin"],
      company_plan: ["starter", "professional", "builder"],
      tenant_role: ["tenant_admin", "agency_manager", "agent", "accountant"],
    },
  },
} as const;
