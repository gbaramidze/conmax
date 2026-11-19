-- Подпись почты с картинками: логотип хранится в самой подписи (data:image, ужатый на сайте до ~600 px),
-- при отправке функция `mail` прикрепляет его к письму встроенным вложением (cid), как делает Outlook.
-- Прежний предел 20 000 знаков такую подпись не вмещал.
alter table public.mail_accounts drop constraint mail_accounts_signature_check;
alter table public.mail_accounts add constraint mail_accounts_signature_check
  check (signature is null or char_length(signature) <= 1500000);
