import { Compass, Home } from "../../components/icons";
import { useNavigate } from "react-router";
import { Screen } from "../../components/Layout";
import { Button, EmptyState } from "../../components/ui";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <Screen title="Не найдено">
      <div className="mt-5">
        <EmptyState
          icon={<Compass className="size-6" />}
          title="Такого раздела нет"
          text="Ссылка устарела или раздел недоступен для вашей роли"
          action={<Button onClick={() => navigate("/", { replace: true })} icon={<Home className="size-4" weight="fill" />}>На главную</Button>}
        />
      </div>
    </Screen>
  );
}
