import { isApiError, type VizColumn } from '@lightdash/common';
import {
    Button,
    Collapse,
    Group,
    List,
    LoadingOverlay,
    Modal,
    Stack,
    Text,
    type ModalProps,
} from '@mantine/core';
import {
    IconAlertCircle,
    IconAlertHexagon,
    IconPlus,
    IconTableAlias,
    IconTrash,
} from '@tabler/icons-react';
import { memo, useEffect, useState, type FC } from 'react';
import { useHistory } from 'react-router-dom';
import MantineIcon from '../../../../components/common/MantineIcon';
import useToaster from '../../../../hooks/toaster/useToaster';
import { useSqlQueryRun } from '../../hooks/useSqlQueryRun';
import { useUpdateVirtualView } from '../../hooks/useVirtualView';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setSqlRunnerResults } from '../../store/sqlRunnerSlice';
import { compareColumns, type ColumnDiff } from '../../utils/compareColumns';

const DiffListItem: FC<{ diff: ColumnDiff }> = memo(({ diff }) => {
    return (
        <List.Item
            fz="xs"
            icon={
                <MantineIcon
                    icon={
                        diff.type === 'deleted' ? IconTrash : IconAlertHexagon
                    }
                    color={diff.type === 'deleted' ? 'red' : 'yellow'}
                />
            }
        >
            {diff.type === 'deleted' ? (
                <Text>
                    <Text span fw={500}>
                        {diff.reference}
                    </Text>{' '}
                    has been deleted
                </Text>
            ) : (
                <Text>
                    <Text span fw={500}>
                        {diff.reference}
                    </Text>{' '}
                    type changed from{' '}
                    <Text span fw={500}>
                        {diff.oldType}
                    </Text>{' '}
                    →{' '}
                    <Text span fw={500}>
                        {diff.newType}
                    </Text>
                </Text>
            )}
        </List.Item>
    );
});

const ColumnDiffModal: FC<
    Pick<ModalProps, 'opened' | 'onClose'> & {
        columnDiffs: ColumnDiff[];
        onSave: () => void;
    }
> = ({ opened, onClose, columnDiffs, onSave }) => {
    const newColumnsAddedNr = columnDiffs.filter(
        (diff) => diff.type === 'added',
    ).length;
    const affectedColumns = columnDiffs.filter((diff) => diff.type !== 'added');
    const isDiffListTruncated = affectedColumns.length > 3;
    const [showAllChanges, setShowAllChanges] = useState(false);
    const visibleDiffs = affectedColumns.slice(0, 3);
    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <Group spacing="xs">
                    <MantineIcon icon={IconAlertCircle} color="orange" />
                    <Text fw={500}>Schema changes detected</Text>
                </Group>
            }
        >
            <Stack>
                <Text fz="xs">Your changes rename or delete a field.</Text>

                <Stack
                    spacing={0}
                    sx={(theme) => ({
                        border: `1px solid ${theme.colors.gray[3]}`,
                        borderRadius: theme.radius.md,
                        padding: theme.spacing.xs,
                        backgroundColor: theme.colors.gray[0],
                    })}
                >
                    <List>
                        {newColumnsAddedNr > 0 && (
                            <List.Item
                                icon={
                                    <MantineIcon
                                        icon={IconPlus}
                                        color="green"
                                    />
                                }
                            >
                                <Text fz="xs">
                                    {newColumnsAddedNr} new column(s) added
                                </Text>
                            </List.Item>
                        )}
                        {visibleDiffs.map((diff, index) => (
                            <DiffListItem key={index} diff={diff} />
                        ))}
                    </List>
                    {isDiffListTruncated && (
                        <>
                            <Collapse in={showAllChanges}>
                                <List>
                                    {affectedColumns
                                        .slice(3)
                                        .map((diff, index) => (
                                            <DiffListItem
                                                key={index + 3}
                                                diff={diff}
                                            />
                                        ))}
                                </List>
                            </Collapse>
                            <Button
                                compact
                                ml="auto"
                                variant="default"
                                size="xs"
                                onClick={() =>
                                    setShowAllChanges(!showAllChanges)
                                }
                            >
                                {showAllChanges ? 'Show Less' : 'Show More'}
                            </Button>
                        </>
                    )}
                </Stack>
                <Text fz="xs" fw={500}>
                    These changes could break existing content using this
                    virtual view. <br />
                    Are you sure you want to save these changes?
                </Text>
            </Stack>
            <Group position="right" spacing="xs" mt="md">
                <Button variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                <Button onClick={onSave}>Save Anyway</Button>
            </Group>
        </Modal>
    );
};

export const HeaderVirtualView: FC<{
    virtualViewState: { name: string; sql: string };
}> = ({ virtualViewState }) => {
    const { showToastError } = useToaster();
    const dispatch = useAppDispatch();
    const [initialColumns, setInitialColumns] = useState<
        VizColumn[] | undefined
    >(undefined);
    const columns = useAppSelector((state) => state.sqlRunner.sqlColumns);
    const [columnDiffs, setColumnDiffs] = useState<ColumnDiff[]>([]);

    const [showWarningModal, setShowWarningModal] = useState(false);

    const history = useHistory();
    const sql = useAppSelector((state) => state.sqlRunner.sql);
    const projectUuid = useAppSelector((state) => state.sqlRunner.projectUuid);
    const hasUnrunChanges = useAppSelector(
        (state) => state.sqlRunner.hasUnrunChanges,
    );

    const { mutateAsync: runQuery, isLoading: isRunningQuery } =
        useSqlQueryRun(projectUuid);

    const { mutateAsync: updateVirtualView, isLoading: isUpdatingVirtualView } =
        useUpdateVirtualView(projectUuid);

    useEffect(() => {
        if (!columns) {
            return;
        }
        if (!initialColumns) {
            setInitialColumns(columns);
        }
    }, [initialColumns, columns]);

    const handleUpdateVirtualView = async ({
        handleDiff,
    }: {
        handleDiff: boolean;
    }) => {
        if (!columns) {
            return;
        }

        let columnsFromQuery: VizColumn[] | undefined = columns;
        if (hasUnrunChanges) {
            try {
                const results = await runQuery({ sql, limit: 1 });

                if (results) {
                    dispatch(setSqlRunnerResults(results));
                    columnsFromQuery = results.columns;
                }
            } catch (error: unknown) {
                if (isApiError(error)) {
                    showToastError({
                        title: 'Error running query',
                        subtitle: error.error.message,
                    });
                }
                return;
            }
        }

        if (handleDiff && initialColumns) {
            const diffs = compareColumns(initialColumns, columnsFromQuery);
            // TODO: Add check for existing charts and/or dashboards that use the virtual view

            if (!diffs || diffs.length === 0) {
                await updateVirtualView({
                    projectUuid,
                    name: virtualViewState.name,
                    sql,
                    columns: columnsFromQuery,
                });
                history.go(0);
            } else {
                setColumnDiffs(diffs);
                setShowWarningModal(true);
            }
        } else {
            await updateVirtualView({
                projectUuid,
                name: virtualViewState.name,
                sql,
                columns,
            });
            history.go(0);
        }
    };

    return (
        <Group
            p="md"
            py="xs"
            position="apart"
            sx={(theme) => ({
                borderBottom: `1px solid ${theme.colors.gray[3]}`,
            })}
        >
            <LoadingOverlay
                visible={isRunningQuery || isUpdatingVirtualView}
                loaderProps={{
                    variant: 'bars',
                }}
            />
            <Group spacing="xs">
                <Group spacing="xs">
                    <MantineIcon icon={IconTableAlias} />
                    <Text fz="sm" fw={500}>
                        {/* TODO: Allow editing name */}
                        Editing {virtualViewState.name}
                    </Text>
                </Group>
            </Group>

            <Button
                mr="lg"
                size="xs"
                variant="default"
                onClick={() => handleUpdateVirtualView({ handleDiff: true })}
            >
                Save
            </Button>
            <ColumnDiffModal
                opened={showWarningModal}
                onSave={() => handleUpdateVirtualView({ handleDiff: false })}
                onClose={() => setShowWarningModal(false)}
                columnDiffs={columnDiffs}
            />
        </Group>
    );
};
